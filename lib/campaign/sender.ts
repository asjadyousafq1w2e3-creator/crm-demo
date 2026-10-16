import { prisma } from "../db";
import { scheduleNextStep } from "./sequence";
import { config, liveSendingAllowed } from "../config";
import { providerFor } from "../mail";
import { signUnsubscribeToken } from "../crypto";
import { checkSendable } from "./eligibility";
import { renderBoth } from "./personalize";
import { localDate } from "./schedule";
import { route } from "./router";
import { footerCompliance, footerProblem, getSettings } from "../settings";
import { classifyFailure, explainFailure, mailboxStateFor } from "../mail/errors";
import type { Campaign, CampaignRecipient, Mailbox, Pharmacy } from "@prisma/client";

async function audit(eventType: string, data: Partial<{
  pharmacyId: number; batchId: number; taskId: number; detail: string; actor: string;
}> = {}) {
  await prisma.auditEvent.create({ data: { eventType, actor: data.actor ?? "worker", ...data } });
}

/**
 * Claim one queued recipient using a row lock, so two workers can never take the same row.
 * SKIP LOCKED means a busy row is passed over rather than blocking the second worker.
 */
export async function claimNextRecipient(campaignId: number): Promise<CampaignRecipient | null> {
  // Raw query for the row lock only - it returns snake_case columns, so we take the id and
  // re-read through Prisma to get a properly typed record.
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM campaign_recipient
    WHERE campaign_id = ${campaignId}
      AND status IN ('QUEUED','SCHEDULED')
      AND (scheduled_at IS NULL OR scheduled_at <= NOW())
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1`;
  if (!rows.length) return null;
  const claimed = await prisma.campaignRecipient.updateMany({
    where: { id: rows[0].id, status: { in: ["QUEUED", "SCHEDULED"] } },
    data: { status: "SENDING", updatedAt: new Date() },
  });
  if (claimed.count !== 1) return null;          // lost the race; another worker took it
  return prisma.campaignRecipient.findUnique({ where: { id: rows[0].id } });
}

/**
 * Returns rows that a crashed worker left mid-flight, and rows whose failure is worth another go.
 *
 * Both are recoveries, not retries of a decision: a recipient BLOCKED by eligibility stays
 * blocked, and a bounce is never retried. This only covers "the send did not complete because
 * something on our side went wrong", which is the case that would otherwise strand a recipient
 * in SENDING forever and stop the campaign from ever completing.
 */
export async function recoverStalledWork(now: Date = new Date()) {
  const claimCutoff = new Date(now.getTime() - config.retry.claimTimeoutMinutes * 60_000);

  const stuck = await prisma.campaignRecipient.updateMany({
    where: { status: "SENDING", updatedAt: { lt: claimCutoff } },
    data: { status: "QUEUED", errorMessage: "reclaimed after an interrupted send" },
  });
  if (stuck.count)
    await audit("SEND_RECLAIMED", { detail: `${stuck.count} recipient(s) stuck in SENDING` });

  // Exponential backoff from the moment of failure: 5, 10, 20 minutes by default.
  const retryable = await prisma.campaignRecipient.findMany({
    where: {
      status: "FAILED",
      attempts: { lt: config.retry.maxAttempts },
      failedAt: { not: null },
      campaign: { status: "RUNNING" },
    },
    select: { id: true, attempts: true, failedAt: true },
    take: 500,
  });
  const due = retryable.filter((r) => {
    const wait = config.retry.backoffMinutes * 2 ** Math.max(0, r.attempts - 1) * 60_000;
    return r.failedAt !== null && now.getTime() - r.failedAt.getTime() >= wait;
  });
  if (due.length) {
    await prisma.campaignRecipient.updateMany({
      where: { id: { in: due.map((r) => r.id) } },
      data: { status: "QUEUED", failedAt: null },
    });
    await audit("SEND_RETRIED", { detail: `${due.length} recipient(s) requeued after a failure` });
  }

  return { reclaimed: stuck.count, requeued: due.length };
}

export type SendOutcome =
  | { result: "SENT"; providerMessageId: string }
  | { result: "BLOCKED"; reason: string }
  | { result: "FAILED"; reason: string };

/**
 * Send one message to one recipient. Never BCC, never batched - one API call per pharmacy.
 */
export async function sendOne(
  recipient: CampaignRecipient, campaign: Campaign, pharmacy: Pharmacy, mailbox: Mailbox,
): Promise<SendOutcome> {
  // Final eligibility gate. State may have changed since the recipient was queued.
  const verdict = await checkSendable(pharmacy);
  if (!verdict.eligible) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "BLOCKED", blockReason: verdict.reason, updatedAt: new Date() },
    });
    await audit("RECIPIENT_BLOCKED", { pharmacyId: pharmacy.id, detail: verdict.reason });
    return { result: "BLOCKED", reason: verdict.reason };
  }

  // Checked per send as well as at start: a campaign can be running when somebody clears the
  // company address, and the messages after that point would be just as unlawful as the ones
  // before it would have been.
  const footer = await footerCompliance();
  if (!footer.ok) {
    const reason = footerProblem(footer)!;
    await prisma.campaignRecipient.update({
      where: { id: recipient.id }, data: { status: "BLOCKED", blockReason: reason } });
    await audit("RECIPIENT_BLOCKED", { pharmacyId: pharmacy.id, detail: reason });
    return { result: "BLOCKED", reason };
  }

  // In gmail mode without the live switch, nothing may leave the process.
  if (config.emailMode === "gmail") {
    const live = liveSendingAllowed();
    if (!live.allowed) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "BLOCKED", blockReason: `live sending disabled: ${live.reason}` },
      });
      return { result: "BLOCKED", reason: live.reason };
    }
  }

  // Which message this is. Step 1 is the campaign's own; later steps carry their own wording,
  // and a step with no subject stays on the original thread, which is how a follow-up reads to
  // the person receiving it.
  const step = recipient.stepNumber > 1
    ? await prisma.campaignStep.findFirst({
        where: { campaignId: campaign.id, stepNumber: recipient.stepNumber, active: true } })
    : null;
  if (recipient.stepNumber > 1 && !step) {
    // The step was turned off after this send was scheduled. Nothing to send, and nothing wrong.
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "SENT", nextStepAt: null, stoppedReason: "COMPLETED" } });
    return { result: "BLOCKED", reason: `step ${recipient.stepNumber} is switched off` };
  }

  const rendered = renderBoth(
    step?.subject || campaign.subject,
    step?.bodyText ?? campaign.bodyText,
    step?.bodyHtml ?? campaign.bodyHtml,
    pharmacy);
  const unsubToken = signUnsubscribeToken(recipient.recipientEmail);
  const unsubUrl = `${config.appUrl}/unsubscribe/${unsubToken}`;
  // RFC 8058 one-click posts to this endpoint; the human-facing link stays the page above.
  const unsubPostUrl = `${config.appUrl}/api/unsubscribe/${unsubToken}`;
  // The verdict above already carries the rendered line, so it is not fetched twice.
  const footerLine = footer.line;
  // company.replyTo has been editable in Settings all along and was never put on a message.
  // Blank stays blank, which is the sensible default: replies coming back to the sending mailbox
  // are what lets the inbox thread them.
  const replyTo = (await getSettings())["company.replyTo"]?.trim() || undefined;

  const bodyText = `${rendered.bodyText}\n\n${campaign.signature ?? ""}\n\n--\n${footerLine}\nUnsubscribe: ${unsubUrl}`;
  const bodyHtml = `${rendered.bodyHtml}${campaign.signature ? `<p>${campaign.signature}</p>` : ""}` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">` +
    `<p style="font-size:12px;color:#666">${footerLine}<br>` +
    `<a href="${unsubUrl}">Unsubscribe</a></p>`;

  try {
    const provider = providerFor(mailbox);
    const res = await provider.sendMessage({
      from: mailbox.emailAddress, fromName: mailbox.displayName ?? undefined,
      to: recipient.recipientEmail, subject: rendered.subject,
      bodyText, bodyHtml, listUnsubscribe: unsubPostUrl, replyTo,
    });

    await prisma.$transaction([
      prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: {
          // Gmail accepting the message means SENT, not DELIVERED. We never claim delivery.
          status: "SENT", sentAt: new Date(), mailboxId: mailbox.id,
          providerMessageId: res.providerMessageId, providerThreadId: res.providerThreadId,
          attempts: { increment: 1 }, updatedAt: new Date(),
        },
      }),
      prisma.pharmacy.update({
        where: { id: pharmacy.id },
        data: {
          leadStatus: "SENT",
          // First contact decides who owns the relationship; later sends reuse it.
          assignedMailboxId: pharmacy.assignedMailboxId ?? mailbox.id,
        },
      }),
      prisma.mailbox.update({
        where: { id: mailbox.id },
        data: mailbox.sentDate === localDate(mailbox.timezone)
          ? { sentToday: { increment: 1 }, lastError: null }
          : { sentToday: 1, sentDate: localDate(mailbox.timezone), lastError: null },
      }),
      prisma.campaign.update({
        where: { id: campaign.id },
        data: campaign.sentDate === localDate(campaign.timezone)
          ? { sentToday: { increment: 1 } }
          : { sentToday: 1, sentDate: localDate(campaign.timezone) },
      }),
    ]);
    // The step record is the proof of what was actually sent, and its unique key on
    // (recipient, step) is what stops a retry sending the same follow-up twice.
    await prisma.campaignRecipientStep.upsert({
      where: { recipientId_stepNumber: { recipientId: recipient.id,
                                         stepNumber: recipient.stepNumber } },
      update: { sentAt: new Date(), providerMessageId: res.providerMessageId, status: "SENT" },
      create: { recipientId: recipient.id, stepNumber: recipient.stepNumber,
                sentAt: new Date(), providerMessageId: res.providerMessageId, status: "SENT" },
    });
    await scheduleNextStep(recipient.id);

    await audit("EMAIL_SENT", {
      pharmacyId: pharmacy.id,
      detail: `${res.providerMessageId}${recipient.stepNumber > 1
        ? ` (step ${recipient.stepNumber})` : ""}`,
    });
    return { result: "SENT", providerMessageId: res.providerMessageId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "FAILED", failedAt: new Date(), errorMessage: reason.slice(0, 400),
        attempts: { increment: 1 }, updatedAt: new Date(),
      },
    });
    const kind = classifyFailure(reason);
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { lastError: `${explainFailure(kind)}: ${reason.slice(0, 300)}`,
              // Only an auth failure takes the mailbox out of rotation; a transient blip must not
              // disable a working sender on one bad call.
              ...(kind === "AUTH" ? mailboxStateFor(kind) : {}) },
    });
    if (kind === "AUTH") {
      await prisma.auditEvent.create({
        data: { eventType: "MAILBOX_NEEDS_RECONNECT", actor: "worker",
                detail: `${mailbox.emailAddress}: ${reason.slice(0, 160)}` } });
    }
    // The attempt counter is what recoverStalledWork uses to decide whether to try again, and
    // when to stop: a permanently broken address should not be retried forever.
    const attempts = recipient.attempts + 1;
    await audit("EMAIL_FAILED", {
      pharmacyId: pharmacy.id,
      detail: `${reason.slice(0, 180)} (attempt ${attempts}/${config.retry.maxAttempts})`,
    });
    return { result: "FAILED", reason };
  }
}

/**
 * The mailboxes a campaign may send from: its own pool if it declares one, otherwise every
 * mailbox. An empty pool means "any", so a campaign created before pools existed is unaffected.
 */
export async function poolFor(campaignId: number) {
  const pool = await prisma.campaignMailbox.findMany({
    where: { campaignId }, include: { mailbox: true }, orderBy: { mailboxId: "asc" },
  });
  if (pool.length) return pool.map((p) => p.mailbox);
  return prisma.mailbox.findMany({ orderBy: { id: "asc" } });
}

/**
 * Pick a mailbox for one recipient of one campaign, honouring the pool, the pharmacy's assigned
 * mailbox, and each mailbox's window, quota, health and connection state.
 */
export async function selectMailbox(
  at: Date = new Date(),
  opts: { campaignId?: number; assignedMailboxId?: number | null; useAssigned?: boolean } = {},
) {
  const mailboxes = opts.campaignId
    ? await poolFor(opts.campaignId)
    : await prisma.mailbox.findMany({ orderBy: { id: "asc" } });
  return route(mailboxes, at, {
    assignedMailboxId: opts.assignedMailboxId, useAssigned: opts.useAssigned,
  });
}
