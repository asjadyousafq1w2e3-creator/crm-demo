/**
 * Campaign worker. Runs as its own process/container - campaign processing must never depend
 * on an admin keeping a browser tab open.
 *
 *   npm run worker         continuous
 *   npm run worker:once    a single tick, used by the tests
 */
import { prisma } from "../lib/db";
import { assertConfig, config } from "../lib/config";
import { localDate, windowStatus, withinDateRange } from "../lib/campaign/schedule";
import { promoteDueSteps } from "../lib/campaign/sequence";
import { wakeSnoozed } from "../lib/inbox/triage";
import { promoteDue } from "../lib/followup/service";
import { selectMailbox, claimNextRecipient, sendOne, recoverStalledWork }
  from "../lib/campaign/sender";
import { globalHeadroom } from "../lib/campaign/router";
import { isSuspended } from "../lib/system-state";
import { syncAllMailboxes } from "../lib/mail/sync";
import { enforceSafetyBrakes } from "../lib/campaign/health";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 15_000);
const SYNC_EVERY_TICKS = Number(process.env.WORKER_SYNC_EVERY_TICKS ?? 20);

export type TickSummary = {
  campaignsConsidered: number;
  sent: number;
  blocked: number;
  failed: number;
  skipped: string[];
  autoPaused: string[];
  rerouted: number;
  reclaimed: number;
  requeued: number;
  /** Recipients whose follow-up wait elapsed and who re-entered the send queue this tick. */
  sequenceSteps: number;
};

export async function tick(now = new Date()): Promise<TickSummary> {
  const summary: TickSummary = {
    campaignsConsidered: 0, sent: 0, blocked: 0, failed: 0, skipped: [], autoPaused: [],
    rerouted: 0, reclaimed: 0, requeued: 0, sequenceSteps: 0,
  };

  // A suspended application sends nothing and syncs nothing. Checked first, before recovery,
  // so a pause is a real stop rather than a pause that quietly keeps delivering.
  if (await isSuspended()) {
    summary.skipped.push("the application is suspended");
    return summary;
  }

  // Pick up anything a previous run left mid-flight before deciding what to send now.
  const recovered = await recoverStalledWork(now);

  // Housekeeping that must happen whether or not anything is sending: a follow-up whose day has
  // come, a conversation whose snooze has expired, and a sequence step whose wait is over. Each
  // is also done on page load, so a stopped worker delays these rather than losing them.
  await promoteDue(now);
  await wakeSnoozed(now);
  summary.sequenceSteps = await promoteDueSteps(now);
  summary.reclaimed = recovered.reclaimed;
  summary.requeued = recovered.requeued;

  // Safety brakes run before any sending, so a mailbox that crossed a threshold on the previous
  // tick cannot send again while waiting to be looked at.
  summary.autoPaused = await enforceSafetyBrakes(now);

  // The account-wide ceiling is checked once per tick and then decremented as we send, so
  // adding a mailbox cannot quietly raise total volume past what someone decided it should be.
  const allMailboxes = await prisma.mailbox.findMany();
  let accountHeadroom = globalHeadroom(allMailboxes, now);
  if (accountHeadroom <= 0) {
    summary.skipped.push(`global daily limit of ${config.limits.globalDaily} reached`);
    return summary;
  }

  const campaigns = await prisma.campaign.findMany({
    where: { status: "RUNNING" }, orderBy: { id: "asc" },
  });

  for (const campaign of campaigns) {
    summary.campaignsConsidered++;
    const label = `#${campaign.id} ${campaign.name}`;

    if (!withinDateRange(campaign.scheduledStartAt, campaign.scheduledEndAt, now)) {
      summary.skipped.push(`${label}: outside date range`); continue;
    }
    const w = windowStatus(campaign, now);
    if (!w.open) { summary.skipped.push(`${label}: ${w.reason}`); continue; }

    const today = localDate(campaign.timezone, now);
    const sentToday = campaign.sentDate === today ? campaign.sentToday : 0;
    let campaignHeadroom = campaign.dailyLimit - sentToday;
    if (campaignHeadroom <= 0) {
      summary.skipped.push(`${label}: campaign daily limit reached`); continue;
    }

    // A tick sends at most a small burst; pacing between messages is the scheduler's job,
    // not a randomised delay intended to dodge filters.
    const burst = Math.min(campaignHeadroom, accountHeadroom, 25);
    for (let i = 0; i < burst; i++) {
      if (accountHeadroom <= 0) {
        summary.skipped.push(`global daily limit of ${config.limits.globalDaily} reached`);
        break;
      }
      const recipient = await claimNextRecipient(campaign.id);
      if (!recipient) {
        const remaining = await prisma.campaignRecipient.count({
          where: { campaignId: campaign.id, status: { in: ["QUEUED", "SCHEDULED", "SENDING"] } },
        });
        if (remaining === 0) {
          await prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
          await prisma.auditEvent.create({
            data: { eventType: "CAMPAIGN_COMPLETED", actor: "worker", detail: label },
          });
        }
        break;
      }
      const pharmacy = await prisma.pharmacy.findUnique({ where: { id: recipient.pharmacyId } });
      if (!pharmacy) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "FAILED", errorMessage: "pharmacy record missing" },
        });
        summary.failed++; continue;
      }

      // Routing happens per recipient, not per tick: the pharmacy's assigned mailbox is part of
      // the decision, so two recipients in the same burst can legitimately use different senders.
      const routed = await selectMailbox(now, {
        campaignId: campaign.id,
        assignedMailboxId: pharmacy.assignedMailboxId,
        useAssigned: campaign.useAssignedMailbox,
      });
      if (!routed.ok) {
        // Hand the claim back rather than failing a recipient for a mailbox-side problem.
        await prisma.campaignRecipient.update({
          where: { id: recipient.id }, data: { status: "QUEUED" } });
        summary.skipped.push(`${label}: ${routed.reason}`);
        break;
      }
      if (routed.reason === "assigned mailbox unavailable, rerouted") {
        summary.rerouted++;
        await prisma.auditEvent.create({
          data: { eventType: "MAILBOX_REROUTED", actor: "worker", pharmacyId: pharmacy.id,
                  detail: `assigned mailbox unavailable; sent from ${routed.mailbox.emailAddress}` },
        });
      }

      const outcome = await sendOne(recipient, campaign, pharmacy, routed.mailbox);
      if (outcome.result === "SENT") { summary.sent++; campaignHeadroom--; accountHeadroom--; }
      else if (outcome.result === "BLOCKED") summary.blocked++;
      else summary.failed++;
    }
  }
  return summary;
}

async function main() {
  const once = process.argv.includes("--once");

  // Fail loudly at startup rather than at the first send: a container that will never be able to
  // do its job should not report itself healthy.
  assertConfig();

  console.log(`[worker] mode=${config.emailMode} live=${config.liveSendingEnabled} ` +
              `tick=${TICK_MS}ms${once ? " (single tick)" : ""}`);

  // Graceful shutdown. A container gets SIGTERM on deploy; finishing the tick in flight means a
  // claimed recipient is not left in SENDING for the reclaim timeout to clean up later.
  let stopping = false;
  let sleepTimer: NodeJS.Timeout | undefined;
  const stop = (signal: string) => {
    if (stopping) { console.log(`[worker] ${signal} again - exiting now`); process.exit(1); }
    stopping = true;
    console.log(`[worker] ${signal} received - finishing the current tick, then exiting`);
    if (sleepTimer) clearTimeout(sleepTimer);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  let ticks = 0;
  do {
    try {
      const s = await tick();
      if (s.reclaimed || s.requeued)
        console.log(`[worker] recovered: ${s.reclaimed} reclaimed, ${s.requeued} requeued`);
      if (s.autoPaused.length)
        console.warn(`[worker] AUTO-PAUSED: ${s.autoPaused.join("; ")}`);
      if (s.sent || s.blocked || s.failed || s.skipped.length)
        console.log(`[worker] sent=${s.sent} blocked=${s.blocked} failed=${s.failed}`
                    + (s.sequenceSteps ? ` follow-ups-due=${s.sequenceSteps}` : "") +
                    (s.rerouted ? ` rerouted=${s.rerouted}` : "") +
                    (s.skipped.length ? ` skipped=${s.skipped.join("; ")}` : ""));
      if (++ticks % SYNC_EVERY_TICKS === 0 && !(await isSuspended())) {
        const r = await syncAllMailboxes();
        if (r.newMessages) console.log(`[worker] inbox sync: ${r.newMessages} new`);
      }
    } catch (e) {
      console.error("[worker] tick error:", e instanceof Error ? e.message : e);
    }
    if (once || stopping) break;
    await new Promise<void>((resolve) => { sleepTimer = setTimeout(resolve, TICK_MS); });
  } while (!stopping);

  await prisma.$disconnect();
  console.log("[worker] stopped cleanly");
}

if (process.argv[1]?.includes("worker")) main();
