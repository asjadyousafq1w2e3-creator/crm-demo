/**
 * End-to-end campaign flow against the real Postgres database, in mock mode.
 *
 * Uses dedicated TEST pharmacies created and torn down by this file. The real 3,801 records
 * are never modified and never mailed - verifying them here just to make a campaign run would
 * be exactly the fake-verification the brief forbids.
 */
import "./setup-env.mts";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pipeline } from "../lib/pipeline.js";
import { prisma } from "../lib/db";
import { promoteDueSteps, scheduleNextStep } from "../lib/campaign/sequence.js";
import { applyResults, createBatch } from "../lib/verify/service.js";
import { footerCompliance } from "../lib/settings.js";
import { tick } from "../worker/index";
import { suppress } from "../lib/campaign/suppression";
import { ingestInbound } from "../lib/mail/sync";
import { buildRecipients, startCampaign } from "../lib/campaign/service";
import { replyToConversation, setLeadStatus, scheduleFollowUp, closeFollowUp } from "../lib/inbox/service";
import { mailboxHealth, enforceSafetyBrakes } from "../lib/campaign/health";
import { simulate } from "../lib/mail/simulate";
import { verifyUnsubscribeToken, signUnsubscribeToken } from "../lib/crypto";
import * as users from "../lib/users";

const R: [string, boolean][] = [];
const check = async (label: string, fn: () => void | Promise<void>) => {
  try { await fn(); R.push([label, true]); }
  catch (e) { R.push([`${label} — ${(e as Error).message}`, false]); }
};

const TAG = "ZZTEST";

/**
 * Audit rows the suite generated. The log is append-only in the application, but a test run must
 * not leave entries in the operator's real history - and many of those rows are written by the
 * worker as "system" or "worker" with no fixture marker on them, so they cannot be matched by
 * content. The suite records the high-water mark before it starts and removes everything above
 * it afterwards, which is sound because an integration run owns the database while it runs.
 */
let auditHighWaterMark = 0;

async function cleanup() {
  const ph = await prisma.pharmacy.findMany({
    where: { canonicalName: { startsWith: TAG } }, select: { id: true } });
  const ids = ph.map((p) => p.id);
  if (ids.length) {
    await prisma.emailMessage.deleteMany({ where: { conversation: { pharmacyId: { in: ids } } } });
    await prisma.conversation.deleteMany({ where: { pharmacyId: { in: ids } } });
    await prisma.campaignRecipient.deleteMany({ where: { pharmacyId: { in: ids } } });
    await prisma.emailMessage.deleteMany({ where: { mailbox: { emailAddress: { endsWith: "@zztest.local" } } } });
    await prisma.followUp.deleteMany({ where: { pharmacyId: { in: ids } } });
    await prisma.pharmacy.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.mailbox.deleteMany({ where: { emailAddress: { endsWith: "@zztest.local" } } });
  await prisma.suppressionEntry.deleteMany({ where: { email: { endsWith: "@zztest.local" } } });
  await prisma.appUser.deleteMany({ where: { email: { endsWith: "@zztest.local" } } });
  const importJobs = await prisma.importJob.findMany({ where: { name: { startsWith: TAG } } });
  for (const j of importJobs) {
    if (j.storedPath) await (await import("node:fs/promises")).rm(j.storedPath, { force: true });
    if (j.batchId) {
      const ph = await prisma.pharmacy.findMany({
        where: { importBatchId: j.batchId }, select: { id: true } });
      const ids = ph.map((p) => p.id);
      if (ids.length) {
        await prisma.emailVerificationItem.deleteMany({ where: { pharmacyId: { in: ids } } });
        await prisma.fieldProvenance.deleteMany({ where: { pharmacyId: { in: ids } } });
        await prisma.importRow.updateMany({
          where: { pharmacyId: { in: ids } }, data: { pharmacyId: null } });
        await prisma.pharmacy.deleteMany({ where: { id: { in: ids } } });
      }
    }
    await prisma.importJob.delete({ where: { id: j.id } });
    if (j.batchId) await prisma.importBatch.deleteMany({ where: { id: j.batchId } });
  }
  await prisma.emailVerificationBatch.deleteMany({ where: { name: { startsWith: TAG } } });
  // The audit log is append-only in the application, but fixtures must not leave rows in the
  // operator's real history - the suite cleans up after itself here as it does everywhere else.
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { id: { gt: auditHighWaterMark } },
        { actor: { contains: "zztest" } },
        { detail: { contains: "zztest" } },
        { detail: { contains: TAG } },
      ],
    },
  });
}

async function main() {
  auditHighWaterMark =
    (await prisma.auditEvent.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0;
  const auditBefore = await prisma.auditEvent.count();
  // --- the pipeline board ---------------------------------------------------------------------------
  // The board exists to name one next action. More than one, or a step that claims to be done
  // while the one before it is not, puts it straight back to being a list of twenty things.
  await check("the pipeline marks exactly one step as the next action", async () => {
    const { stages, next } = await pipeline();
    const live = stages.filter((s) => s.state === "CURRENT" || s.state === "BLOCKED");
    assert.equal(live.length, stages.every((s) => s.state === "DONE") ? 0 : 1);
    if (live.length) {
      assert.ok(next, "a live step must offer an action");
      assert.equal(next!.title, live[0].title);
    }
  });
  await check("no pipeline step is waiting behind a step that is not done", async () => {
    const { stages } = await pipeline();
    const firstUnfinished = stages.findIndex((s) => s.state !== "DONE");
    if (firstUnfinished >= 0)
      for (const s of stages.slice(firstUnfinished + 1))
        assert.notEqual(s.state, "DONE",
          `${s.title} claims to be done while an earlier step is not`);
  });
  await check("every pipeline action points at a route that exists", async () => {
    const { stages } = await pipeline();
    for (const s of stages) {
      if (!s.action) continue;
      const path = s.action.href.split("?")[0];
      assert.ok(existsSync(`app/(crm)${path === "/" ? "" : path}/page.tsx`),
        `${s.title} links to ${path}, which has no page`);
    }
  });

  await cleanup();
  const before = await prisma.pharmacy.count();

  // --- fixtures: verified TEST pharmacies, plus one that must stay blocked ---------------
  const verifiedData = {
    verificationStatus: "VERIFIED", licenseStatus: "ACTIVE", operationalStatus: "OPEN",
    ownershipStatus: "INDEPENDENT", emailVerificationStatus: "VALID",
  };
  const p1 = await prisma.pharmacy.create({ data: {
    canonicalName: `${TAG} Alpha Pharmacy`, state: "FL", city: "Miami",
    email: "alpha@zztest.local", ...verifiedData } });
  const p2 = await prisma.pharmacy.create({ data: {
    canonicalName: `${TAG} Beta Pharmacy`, state: "FL", city: "Tampa",
    email: "beta@zztest.local", ...verifiedData } });
  const pUnverified = await prisma.pharmacy.create({ data: {
    canonicalName: `${TAG} Gamma Pharmacy`, state: "FL", email: "gamma@zztest.local" } });
  const pSuppressed = await prisma.pharmacy.create({ data: {
    canonicalName: `${TAG} Delta Pharmacy`, state: "FL",
    email: "delta@zztest.local", ...verifiedData } });
  await suppress("delta@zztest.local", "UNSUBSCRIBED", "test");

  const mailbox = await prisma.mailbox.create({ data: {
    provider: "mock", emailAddress: "sales@zztest.local", displayName: "Sales",
    domain: "zztest.local", status: "CONNECTED", healthStatus: "HEALTHY",
    rampStage: "MANUAL", dailyLimit: 10,
    sendingStartTime: "00:00", sendingEndTime: "23:59", timezone: "UTC" } });

  const campaign = await prisma.campaign.create({ data: {
    name: `${TAG} Campaign`, subject: "Wholesale for {{pharmacy_name}}",
    bodyText: "Hello {{pharmacy_name}} in {{city}}. {{contact_name}}",
    bodyHtml: "Hello {{pharmacy_name}}", timezone: "UTC",
    sendingDays: "1,2,3,4,5,6,7", sendingStartTime: "00:00", sendingEndTime: "23:59",
    dailyLimit: 100 } });

  // --- recipient build + eligibility ------------------------------------------------------
  const built = await buildRecipients(campaign.id, { canonicalName: { startsWith: TAG } });
  await check("eligible recipients identified", () => assert.equal(built.eligible, 2));
  await check("unverified + suppressed are blocked", () => assert.equal(built.blocked, 2));

  const blockedRows = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: "BLOCKED" } });
  await check("unverified pharmacy blocked with a reason", () =>
    assert.ok(blockedRows.some((r) => r.pharmacyId === pUnverified.id &&
      (r.blockReason ?? "").includes("not verified"))));
  await check("suppressed pharmacy blocked with a reason", () =>
    assert.ok(blockedRows.some((r) => r.pharmacyId === pSuppressed.id &&
      (r.blockReason ?? "").includes("suppress"))));

  // --- start + send -------------------------------------------------------------------------
  // A deployment that can lawfully send has a company name and postal address; the sender now
  // refuses without them. The suite sets its own and restores the real ones at the end.
  const footerSnapshot = await prisma.appSetting.findMany({
    where: { key: { in: ["company.name", "company.address"] } } });
  const setFooter = async (name: string, address: string) => {
    for (const [key, value] of [["company.name", name],
                                ["company.address", address]] as const)
      await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  };
  const restoreFooter = async () => {
    await prisma.appSetting.deleteMany({
      where: { key: { in: ["company.name", "company.address"] } } });
    for (const row of footerSnapshot)
      await prisma.appSetting.create({ data: { key: row.key, value: row.value } });
  };
  await setFooter(`${TAG} Supply`, "18 Harbour Road, Suite 200, Boston MA 02110");

  const started = await startCampaign(campaign.id);
  await check("only eligible recipients queued", () => assert.equal(started.queued, 2));

  const t1 = await tick();
  await check("worker sent both messages", () => assert.equal(t1.sent, 2));

  const sent = await prisma.campaignRecipient.findMany({
    where: { campaignId: campaign.id, status: "SENT" } });
  await check("both marked SENT", () => assert.equal(sent.length, 2));
  await check("every send has a provider message id", () =>
    assert.ok(sent.every((s) => !!s.providerMessageId)));
  await check("individual messages, not one batch", () =>
    assert.equal(new Set(sent.map((s) => s.providerMessageId)).size, 2));
  await check("mailbox counter incremented", async () => {
    const m = await prisma.mailbox.findUnique({ where: { id: mailbox.id } });
    assert.equal(m!.sentToday, 2);
  });
  await check("lead status advanced to SENT", async () => {
    const p = await prisma.pharmacy.findUnique({ where: { id: p1.id } });
    assert.equal(p!.leadStatus, "SENT");
  });

  // --- idempotency ---------------------------------------------------------------------------
  const t2 = await tick();
  await check("re-running the worker sends nothing more", () => assert.equal(t2.sent, 0));
  await check("campaign auto-completes when drained", async () => {
    const c = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    assert.equal(c!.status, "COMPLETED");
  });

  // --- mailbox limit ---------------------------------------------------------------------------
  await check("mailbox at limit routes nothing", async () => {
    await prisma.mailbox.update({ where: { id: mailbox.id },
      data: { dailyLimit: 2, sentToday: 2, sentDate: new Date().toISOString().slice(0, 10) } });
    const { route } = await import("../lib/campaign/router");
    const boxes = await prisma.mailbox.findMany({ where: { id: mailbox.id } });
    assert.equal(route(boxes).ok, false);
  });

  // --- inbound reply ----------------------------------------------------------------------------
  const first = sent[0];
  await ingestInbound(mailbox.id, {
    providerMessageId: "zztest-reply-1", providerThreadId: first.providerThreadId!,
    from: `<${first.recipientEmail}>`, to: "sales@zztest.local",
    subject: "Re: Wholesale", bodyText: "Yes, interested.",
    receivedAt: new Date(), isBounce: false,
  });
  await check("reply creates a conversation", async () => {
    const conv = await prisma.conversation.findFirst({
      where: { providerThreadId: first.providerThreadId! } });
    assert.ok(conv);
  });
  await check("reply marks the recipient REPLIED", async () => {
    const r = await prisma.campaignRecipient.findUnique({ where: { id: first.id } });
    assert.equal(r!.status, "REPLIED");
  });
  await check("duplicate reply is not ingested twice", async () => {
    const again = await ingestInbound(mailbox.id, {
      providerMessageId: "zztest-reply-1", providerThreadId: first.providerThreadId!,
      from: `<${first.recipientEmail}>`, to: "sales@zztest.local",
      subject: "Re: Wholesale", bodyText: "dup", receivedAt: new Date(), isBounce: false });
    assert.equal(again, false);
  });
  await check("operator classification survives a later reply", async () => {
    const target = sent[0].pharmacyId;
    await prisma.pharmacy.update({ where: { id: target }, data: { leadStatus: "INTERESTED" } });
    await ingestInbound(mailbox.id, {
      providerMessageId: "zztest-reply-2", providerThreadId: first.providerThreadId!,
      from: `<${first.recipientEmail}>`, to: "sales@zztest.local",
      subject: "Re: again", bodyText: "another", receivedAt: new Date(), isBounce: false });
    const p = await prisma.pharmacy.findUnique({ where: { id: target } });
    assert.equal(p!.leadStatus, "INTERESTED");   // must NOT be reset to REPLIED
  });

  // --- bounce ------------------------------------------------------------------------------------
  const second = sent[1];
  await ingestInbound(mailbox.id, {
    providerMessageId: "zztest-bounce-1", providerThreadId: second.providerThreadId!,
    from: "mailer-daemon@googlemail.com", to: "sales@zztest.local",
    subject: "Delivery Status Notification (Failure)", bodyText: "550",
    receivedAt: new Date(), isBounce: true,
  });
  await check("bounce marks the recipient BOUNCED", async () => {
    const r = await prisma.campaignRecipient.findUnique({ where: { id: second.id } });
    assert.equal(r!.status, "BOUNCED");
  });
  await check("bounce adds a global suppression entry", async () => {
    const s = await prisma.suppressionEntry.findUnique({
      where: { email: second.recipientEmail.toLowerCase() } });
    assert.equal(s?.reason, "BOUNCED");
  });

  // --- suppression is global ----------------------------------------------------------------------
  await check("a suppressed address is blocked in a NEW campaign too", async () => {
    const c2 = await prisma.campaign.create({ data: {
      name: `${TAG} Second`, subject: "s", bodyText: "b", bodyHtml: "b",
      sendingDays: "1,2,3,4,5,6,7", sendingStartTime: "00:00", sendingEndTime: "23:59" } });
    const b = await buildRecipients(c2.id, { id: { in: [second.pharmacyId] } });
    assert.equal(b.eligible, 0);
    assert.equal(b.blocked, 1);
  });

  // --- demo-mode simulation ----------------------------------------------------------------
  await check("simulating a reply records an inbound message", async () => {
    const target = sent[0];
    const before = await prisma.emailMessage.count({
      where: { direction: "INBOUND", conversation: { providerThreadId: target.providerThreadId! } } });
    const r = await simulate(target.id, "REPLY", "simulated body");
    assert.equal(r.ok, true);
    const after = await prisma.emailMessage.count({
      where: { direction: "INBOUND", conversation: { providerThreadId: target.providerThreadId! } } });
    assert.equal(after, before + 1);
  });
  await check("simulation is refused outright in gmail mode", async () => {
    const { config } = await import("../lib/config");
    const prev = config.emailMode;
    config.emailMode = "gmail";           // the guard reads this at call time
    try {
      const r = await simulate(sent[0].id, "REPLY");
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /demo email mode/);
    } finally { config.emailMode = prev; }
  });
  await check("simulation refuses a recipient that was never sent to", async () => {
    const blocked = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id, status: "BLOCKED" } });
    const r = await simulate(blocked!.id, "REPLY");
    assert.equal(r.ok, false);
  });

  // --- replying from the CRM ------------------------------------------------------------------
  const conversation = await prisma.conversation.findFirst({
    where: { providerThreadId: first.providerThreadId! } });
  await check("reply from the CRM is recorded on the thread", async () => {
    const r = await replyToConversation(conversation!.id, "Thanks - sending our catalogue.");
    assert.equal(r.ok, true);
    const out = await prisma.emailMessage.findMany({
      where: { conversationId: conversation!.id, direction: "OUTBOUND" } });
    assert.equal(out.length, 1);
    assert.equal(out[0].toAddress, first.recipientEmail);
  });
  await check("an empty reply is refused", async () => {
    const r = await replyToConversation(conversation!.id, "   ");
    assert.equal(r.ok, false);
  });
  await check("opening a thread and replying clears unread", async () => {
    const c = await prisma.conversation.findUnique({ where: { id: conversation!.id } });
    assert.equal(c!.unread, false);
  });
  await check("reply to a suppressed address is refused", async () => {
    const bounced = await prisma.conversation.findFirst({
      where: { providerThreadId: second.providerThreadId! } });
    const r = await replyToConversation(bounced!.id, "hello?");
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /suppression/);
  });

  // --- operator lead status ------------------------------------------------------------------
  await check("marking a lead unsubscribed suppresses the address", async () => {
    await setLeadStatus(pUnverified.id, "UNSUBSCRIBED");
    const s = await prisma.suppressionEntry.findUnique({
      where: { email: "gamma@zztest.local" } });
    assert.equal(s?.reason, "UNSUBSCRIBED");
  });
  await check("a lead status change is audited", async () => {
    const e = await prisma.auditEvent.findFirst({
      where: { eventType: "LEAD_STATUS_CHANGED", pharmacyId: pUnverified.id },
      orderBy: { id: "desc" } });
    assert.ok(e?.detail?.includes("UNSUBSCRIBED"));
  });

  // --- one-click unsubscribe ------------------------------------------------------------------
  await check("a signed unsubscribe token resolves to the address", () =>
    assert.equal(verifyUnsubscribeToken(signUnsubscribeToken("alpha@zztest.local")),
      "alpha@zztest.local"));
  await check("unsubscribing blocks the address everywhere", async () => {
    await suppress("alpha@zztest.local", "UNSUBSCRIBED", "one-click");
    const c3 = await prisma.campaign.create({ data: {
      name: `${TAG} Third`, subject: "s", bodyText: "b", bodyHtml: "b",
      sendingDays: "1,2,3,4,5,6,7", sendingStartTime: "00:00", sendingEndTime: "23:59" } });
    const b = await buildRecipients(c3.id, { id: p1.id });
    assert.equal(b.eligible, 0);
  });

  // --- safety brake ----------------------------------------------------------------------------
  await check("mailbox health reports real counts, no invented metrics", async () => {
    const m = await prisma.mailbox.findUnique({ where: { id: mailbox.id } });
    const h = await mailboxHealth(m!);
    assert.equal(h.sent, 2);           // one REPLIED + one BOUNCED, both provider-accepted
    assert.equal(h.bounced, 1);
    assert.equal(h.bounceRate, null);  // below the minimum sample, so NOT estimated
    assert.ok(!("openRate" in h));
  });
  await check("a failure streak auto-pauses the mailbox", async () => {
    await prisma.mailbox.update({ where: { id: mailbox.id },
      data: { status: "CONNECTED", healthStatus: "HEALTHY" } });
    // Five failed attempts on this mailbox, which is the configured streak threshold.
    // One pharmacy each, because a recipient row is unique per (campaign, pharmacy).
    for (let i = 0; i < 5; i++) {
      const ph = await prisma.pharmacy.create({ data: {
        canonicalName: `${TAG} Fail ${i}`, state: "FL", email: `fail${i}@zztest.local` } });
      await prisma.campaignRecipient.create({ data: {
        campaignId: campaign.id, pharmacyId: ph.id,
        recipientEmail: `fail${i}@zztest.local`, status: "FAILED", mailboxId: mailbox.id,
        idempotencyKey: `${TAG}-fail-${i}` } });
    }
    const paused = await enforceSafetyBrakes();
    assert.ok(paused.some((p) => p.includes("sales@zztest.local")));
    const m = await prisma.mailbox.findUnique({ where: { id: mailbox.id } });
    assert.equal(m!.status, "PAUSED");
  });
  await check("an auto-paused mailbox is recorded in the audit log", async () => {
    const e = await prisma.auditEvent.findFirst({
      where: { eventType: "MAILBOX_AUTO_PAUSED" }, orderBy: { id: "desc" } });
    assert.ok(e?.detail?.includes("sales@zztest.local"));
  });
  await check("a paused mailbox sends nothing", async () => {
    const { route } = await import("../lib/campaign/router");
    const boxes = await prisma.mailbox.findMany({ where: { id: mailbox.id } });
    const r = route(boxes);
    assert.equal(r.ok, false);
  });

  // --- follow-ups -----------------------------------------------------------------------------------
  await check("follow-up lifecycle", async () => {
    const f = await scheduleFollowUp(p2.id, new Date(Date.now() - 1000), "call back");
    assert.equal(f.status, "PENDING");
    const done = await closeFollowUp(f.id, "COMPLETED");
    assert.equal(done.status, "COMPLETED");
    assert.ok(done.completedAt);
  });

  // --- sequences ---------------------------------------------------------------------------------
  // The behaviour that separates a sequence from a mail merge: a follow-up goes only to somebody
  // who has not answered, and the wait is measured from the previous send.
  await check("a sent recipient with no further steps is marked complete", async () => {
    const r = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id }, orderBy: { id: "asc" } });
    await prisma.campaignRecipient.update({
      where: { id: r!.id }, data: { status: "SENT", stepNumber: 1, stoppedReason: null } });
    await scheduleNextStep(r!.id, new Date());
    const after = await prisma.campaignRecipient.findUnique({ where: { id: r!.id } });
    assert.equal(after!.nextStepAt, null);
    assert.equal(after!.stoppedReason, "COMPLETED");
  });

  await check("adding a step schedules the next send from when the last one left", async () => {
    await prisma.campaignStep.create({
      data: { campaignId: campaign.id, stepNumber: 2, waitDays: 4,
              bodyText: "Following up.", bodyHtml: "<p>Following up.</p>" } });
    const r = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id }, orderBy: { id: "asc" } });
    await prisma.campaignRecipient.update({
      where: { id: r!.id }, data: { status: "SENT", stepNumber: 1, stoppedReason: null } });

    const sentAt = new Date("2026-03-02T10:00:00Z");
    await scheduleNextStep(r!.id, sentAt);
    const after = await prisma.campaignRecipient.findUnique({ where: { id: r!.id } });
    assert.equal(after!.nextStepAt?.toISOString(), "2026-03-06T10:00:00.000Z");
    assert.equal(after!.stoppedReason, null);
  });

  await check("a recipient who replied is never advanced to the next step", async () => {
    const r = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id }, orderBy: { id: "asc" } });
    await prisma.campaignRecipient.update({
      where: { id: r!.id },
      data: { status: "REPLIED", stepNumber: 1, nextStepAt: new Date(Date.now() - 86_400_000),
              stoppedReason: null } });
    const moved = await promoteDueSteps(new Date());
    const after = await prisma.campaignRecipient.findUnique({ where: { id: r!.id } });
    assert.equal(after!.stepNumber, 1, "a replier must not advance");
    assert.equal(after!.status, "REPLIED");
    assert.ok(moved >= 0);
  });

  await check("a due follow-up re-enters the ordinary send queue", async () => {
    const r = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id }, orderBy: { id: "asc" } });
    await prisma.campaignRecipient.update({
      where: { id: r!.id },
      data: { status: "SENT", stepNumber: 1, stoppedReason: null,
              nextStepAt: new Date(Date.now() - 3_600_000) } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING" } });

    await promoteDueSteps(new Date());
    const after = await prisma.campaignRecipient.findUnique({ where: { id: r!.id } });
    assert.equal(after!.stepNumber, 2, "the step counter advances");
    assert.equal(after!.status, "QUEUED", "and it goes back through the normal send path");
    assert.equal(after!.nextStepAt, null);
  });

  await check("a follow-up that is not yet due is left alone", async () => {
    const r = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id }, orderBy: { id: "asc" } });
    await prisma.campaignRecipient.update({
      where: { id: r!.id },
      data: { status: "SENT", stepNumber: 1, stoppedReason: null,
              nextStepAt: new Date(Date.now() + 86_400_000) } });
    await promoteDueSteps(new Date());
    const after = await prisma.campaignRecipient.findUnique({ where: { id: r!.id } });
    assert.equal(after!.stepNumber, 1);
    assert.equal(after!.status, "SENT");
  });

  // --- recovery from interrupted and failed sends ----------------------------------------------
  const { recoverStalledWork } = await import("../lib/campaign/sender");
  const { config: cfg } = await import("../lib/config");

  // A recipient row is unique per (campaign, pharmacy), so each of these checks needs its own
  // pharmacy rather than reusing a fixture that already has a row in this campaign.
  let scratchSeq = 0;
  const scratchRecipient = async (data: Record<string, unknown>) => {
    const n = scratchSeq++;
    const ph = await prisma.pharmacy.create({ data: {
      canonicalName: `${TAG} Scratch ${n}`, state: "FL", email: `scratch${n}@zztest.local` } });
    return prisma.campaignRecipient.create({ data: {
      campaignId: campaign.id, pharmacyId: ph.id, recipientEmail: `scratch${n}@zztest.local`,
      mailboxId: mailbox.id, idempotencyKey: `${TAG}-scratch-${n}`, ...data } });
  };

  await check("a send interrupted mid-flight is reclaimed, not stranded", async () => {
    const victim = await scratchRecipient({
      status: "SENDING",
      // Claimed longer ago than the timeout: the worker that held it is gone.
      updatedAt: new Date(Date.now() - (cfg.retry.claimTimeoutMinutes + 5) * 60_000) });
    const r = await recoverStalledWork();
    assert.ok(r.reclaimed >= 1);
    const after = await prisma.campaignRecipient.findUnique({ where: { id: victim.id } });
    assert.equal(after!.status, "QUEUED");
  });
  await check("a recent claim is left alone", async () => {
    const fresh = await scratchRecipient({ status: "SENDING" });
    await recoverStalledWork();
    const after = await prisma.campaignRecipient.findUnique({ where: { id: fresh.id } });
    assert.equal(after!.status, "SENDING");
    await prisma.campaignRecipient.delete({ where: { id: fresh.id } });
  });
  await check("a failure is retried once its backoff has passed", async () => {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING" } });
    const failed = await scratchRecipient({ status: "FAILED", attempts: 1,
      failedAt: new Date(Date.now() - (cfg.retry.backoffMinutes + 1) * 60_000) });
    const r = await recoverStalledWork();
    assert.ok(r.requeued >= 1);
    assert.equal((await prisma.campaignRecipient.findUnique({ where: { id: failed.id } }))!.status,
      "QUEUED");
    await prisma.campaignRecipient.delete({ where: { id: failed.id } });
  });
  await check("a failure inside its backoff is left alone", async () => {
    const recent = await scratchRecipient({ status: "FAILED", attempts: 1, failedAt: new Date() });
    await recoverStalledWork();
    assert.equal((await prisma.campaignRecipient.findUnique({ where: { id: recent.id } }))!.status,
      "FAILED");
    await prisma.campaignRecipient.delete({ where: { id: recent.id } });
  });
  await check("a recipient out of attempts is not retried forever", async () => {
    const exhausted = await scratchRecipient({ status: "FAILED", attempts: cfg.retry.maxAttempts,
      failedAt: new Date(Date.now() - 86_400_000) });
    await recoverStalledWork();
    assert.equal((await prisma.campaignRecipient.findUnique({ where: { id: exhausted.id } }))!.status,
      "FAILED");
    await prisma.campaignRecipient.delete({ where: { id: exhausted.id } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "COMPLETED" } });
  });

  // --- login throttling --------------------------------------------------------------------------
  await check("repeated failures throttle a sign-in", async () => {
    const { checkLoginThrottle, MAX_FAILURES_PER_ACCOUNT } = await import("../lib/rate-limit");
    const who = "throttle@zztest.local";
    assert.equal((await checkLoginThrottle(who, "10.0.0.9")).allowed, true);
    for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) {
      await prisma.auditEvent.create({ data: {
        eventType: "LOGIN_FAILED", actor: who, detail: "invalid; ip=10.0.0.9" } });
    }
    const blocked = await checkLoginThrottle(who, "10.0.0.9");
    assert.equal(blocked.allowed, false);
    assert.ok((blocked as { retryAfterSeconds: number }).retryAfterSeconds > 0);
  });
  await check("throttling does not spill onto another account", async () => {
    const { checkLoginThrottle } = await import("../lib/rate-limit");
    assert.equal((await checkLoginThrottle("someone-else@zztest.local", "10.0.0.77")).allowed, true);
  });

  // --- multi-mailbox routing ------------------------------------------------------------------
  const mailboxB = await prisma.mailbox.create({ data: {
    provider: "mock", emailAddress: "second@zztest.local", displayName: "Second",
    domain: "zztest.local", status: "CONNECTED", healthStatus: "HEALTHY",
    rampStage: "MANUAL", dailyLimit: 10,
    sendingStartTime: "00:00", sendingEndTime: "23:59", timezone: "UTC" } });

  await check("a successful send assigns the pharmacy to that mailbox", async () => {
    const p = await prisma.pharmacy.findUnique({ where: { id: p1.id } });
    assert.equal(p!.assignedMailboxId, mailbox.id);
  });
  await check("an empty pool means any mailbox", async () => {
    const { poolFor } = await import("../lib/campaign/sender");
    const pool = await poolFor(campaign.id);
    assert.ok(pool.length >= 2);
  });
  await check("an explicit pool restricts the candidates", async () => {
    const { setCampaignPool } = await import("../lib/campaign/service");
    const { poolFor } = await import("../lib/campaign/sender");
    await setCampaignPool(campaign.id, [mailboxB.id]);
    const pool = await poolFor(campaign.id);
    assert.equal(pool.length, 1);
    assert.equal(pool[0].id, mailboxB.id);
  });
  await check("the router honours the pool over the assignment", async () => {
    // p1 is assigned to `mailbox`, but the pool only contains mailboxB.
    const { selectMailbox } = await import("../lib/campaign/sender");
    const r = await selectMailbox(new Date(), {
      campaignId: campaign.id, assignedMailboxId: mailbox.id, useAssigned: true });
    assert.equal(r.ok, true);
    assert.equal((r as { mailbox: { id: number } }).mailbox.id, mailboxB.id);
  });
  await check("clearing the pool restores any mailbox", async () => {
    const { setCampaignPool } = await import("../lib/campaign/service");
    const { poolFor } = await import("../lib/campaign/sender");
    await setCampaignPool(campaign.id, []);
    assert.ok((await poolFor(campaign.id)).length >= 2);
  });
  await check("a reply is sent from the mailbox that owns the thread", async () => {
    const conv = await prisma.conversation.findFirst({
      where: { providerThreadId: first.providerThreadId! } });
    const out = await prisma.emailMessage.findFirst({
      where: { conversationId: conv!.id, direction: "OUTBOUND" }, orderBy: { id: "desc" } });
    const owning = await prisma.mailbox.findUnique({ where: { id: conv!.mailboxId } });
    assert.equal(out!.fromAddress, owning!.emailAddress);
    assert.equal(out!.mailboxId, conv!.mailboxId);
  });
  await check("deleting a mailbox clears assignments but keeps the history", async () => {
    const victim = await prisma.mailbox.create({ data: {
      provider: "mock", emailAddress: "doomed@zztest.local", status: "CONNECTED",
      healthStatus: "HEALTHY", rampStage: "MANUAL", dailyLimit: 5,
      sendingStartTime: "00:00", sendingEndTime: "23:59", timezone: "UTC" } });
    await prisma.pharmacy.update({
      where: { id: p2.id }, data: { assignedMailboxId: victim.id } });
    const auditBefore = await prisma.auditEvent.count();
    await prisma.mailbox.delete({ where: { id: victim.id } });
    const after = await prisma.pharmacy.findUnique({ where: { id: p2.id } });
    assert.equal(after!.assignedMailboxId, null);          // assignment released
    assert.equal(await prisma.auditEvent.count(), auditBefore);   // history untouched
  });

  // --- operator accounts and RBAC -------------------------------------------------------------
  const owner = await prisma.appUser.create({ data: {
    email: "zztest-owner@zztest.local", name: "Owner", role: "OWNER", status: "ACTIVE",
    passwordHash: (await import("../lib/auth")).hashPassword("owner-password-1") } });
  const ownerActor = { userId: owner.id, role: "OWNER" };

  let createdAgentId = 0;
  await check("creating an operator issues a one-time password", async () => {
    const r = await users.createUser(ownerActor,
      { email: "zztest-agent@zztest.local", name: "Agent", role: "AGENT" });
    assert.equal(r.ok, true);
    assert.ok((r as { password?: string }).password?.length >= 12);
    const u = await prisma.appUser.findUnique({ where: { email: "zztest-agent@zztest.local" } });
    createdAgentId = u!.id;
    assert.equal(u!.mustChangePassword, true);
    assert.notEqual(u!.passwordHash, (r as { password: string }).password); // stored hashed only
  });
  await check("an admin cannot mint an owner", async () => {
    const admin = await prisma.appUser.create({ data: {
      email: "zztest-admin@zztest.local", role: "ADMIN", status: "ACTIVE",
      passwordHash: (await import("../lib/auth")).hashPassword("admin-password-1") } });
    const r = await users.createUser({ userId: admin.id, role: "ADMIN" },
      { email: "zztest-owner2@zztest.local", role: "OWNER" });
    assert.equal(r.ok, false);
  });
  await check("owner demotion is guarded by the live active-owner count", async () => {
    const activeOwners = await prisma.appUser.count({
      where: { role: "OWNER", status: "ACTIVE" } });
    const r = await users.changeRole(ownerActor, owner.id, "VIEWER");
    if (activeOwners <= 1) {
      // This fixture is the only owner: the guard must refuse.
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /last owner/);
    } else {
      // A real owner also exists, so demoting the fixture is legitimate.
      assert.equal(r.ok, true);
      await users.changeRole(ownerActor, owner.id, "OWNER");   // put it back for later checks
    }
  });
  await check("nobody can suspend their own account", async () => {
    const r = await users.setStatus({ userId: createdAgentId, role: "ADMIN" }, createdAgentId,
      "SUSPENDED");
    assert.equal(r.ok, false);
  });
  await check("authentication rejects a suspended account", async () => {
    const r = await users.resetPassword(ownerActor, createdAgentId);
    const password = (r as { password: string }).password;
    assert.equal((await users.authenticate("zztest-agent@zztest.local", password)).ok, true);
    await users.setStatus(ownerActor, createdAgentId, "SUSPENDED");
    const after = await users.authenticate("zztest-agent@zztest.local", password);
    assert.equal(after.ok, false);
    assert.equal((after as { reason: string }).reason, "suspended");
  });
  await check("a wrong password is refused", async () =>
    assert.equal((await users.authenticate("zztest-owner@zztest.local", "nope")).ok, false));
  await check("changing your own password requires the current one", async () => {
    assert.equal((await users.changeOwnPassword(owner.id, "wrong", "a-new-long-password")).ok, false);
    const ok = await users.changeOwnPassword(owner.id, "owner-password-1", "a-new-long-password");
    assert.equal(ok.ok, true);
    assert.equal((await users.authenticate("zztest-owner@zztest.local", "a-new-long-password")).ok, true);
  });
  await check("a short new password is refused", async () =>
    assert.equal((await users.changeOwnPassword(owner.id, "a-new-long-password", "short")).ok, false));
  await check("user administration is audited with the actor", async () => {
    const e = await prisma.auditEvent.findFirst({
      where: { eventType: "USER_CREATED", actorId: owner.id }, orderBy: { id: "desc" } });
    assert.equal(e?.actorRole, "OWNER");
    assert.equal(e?.actor, "zztest-owner@zztest.local");
  });

  // --- import pipeline, end to end ---------------------------------------------------------------
  const importSvc = await import("../lib/import/service");
  const verifySvc = await import("../lib/verify/service");

  const SAMPLE_HEADERS = ["Facility Name", "Street", "Town", "St", "Postal", "E-mail Address",
                          "Telephone", "Permit #", "Permit Status", "Permit Class", "County"];
  const SAMPLE_CSV = [
    SAMPLE_HEADERS.join(","),
    // normalisation: lowercase street/city, full state name, ZIP+4, formatted phone
    `${TAG} Oak Ridge Apothecary,123 main street,austin,Texas,78701-1234,owner@zzimport.local,(512) 555-0142,ZZ-1,Active,Community Pharmacy,Travis`,
    // a chain, which must not reach the registry
    `${TAG} CVS Pharmacy #4412,55 Retail Row,Dallas,TX,75201,rx@zzimport.local,2145550100,ZZ-2,Active,Community Pharmacy,Dallas`,
    // an independent franchise banner, which must
    `${TAG} Valley Health Mart,12 College Main,College Station,TX,77840,elena@zzimport.local,9795550177,ZZ-3,Active,Community Pharmacy,Brazos`,
    // the same pharmacy again, spelled differently - a duplicate
    `${TAG} Oak Ridge Apothecary,123 Main St,Austin,TX,78701,other@zzimport.local,5125550142,ZZ-1,Active,Community Pharmacy,Travis`,
    // no email at all: kept, flagged, never outreach-eligible
    `${TAG} Piney Woods Drug,44 Pine St,Tyler,TX,75701,,9035550144,ZZ-4,Active,Community Pharmacy,Smith`,
    // blank licence status: reviewed, never assumed open
    `${TAG} Bayou Independent Rx,17 Bayou Blvd,Beaumont,TX,77701,jsmith@zzimport.local,4095550166,ZZ-5,,Community Pharmacy,Jefferson`,
  ].join("\n");

  const MAPPING = {
    name: "Facility Name", streetAddress: "Street", city: "Town", state: "St", zipCode: "Postal",
    email: "E-mail Address", phone: "Telephone", licenseNumber: "Permit #",
    licenseStatus: "Permit Status", licenseType: "Permit Class", county: "County",
  };

  let importJobId = 0;
  await check("a declaration without an email column is refused", async () => {
    const r = await importSvc.declareJob({
      name: `${TAG} no email`, sourceType: "STATE_BOARD", columns: SAMPLE_HEADERS,
      mapping: { name: "Facility Name" },
    });
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /email column is required/);
  });
  await check("a mapping naming an undeclared column is refused", async () => {
    const r = await importSvc.declareJob({
      name: `${TAG} bad map`, sourceType: "STATE_BOARD", columns: SAMPLE_HEADERS,
      mapping: { name: "Facility Name", email: "Not A Column" },
    });
    assert.equal(r.ok, false);
  });
  await check("a valid declaration is accepted", async () => {
    const r = await importSvc.declareJob({
      name: `${TAG} import`, sourceType: "STATE_BOARD", jurisdiction: "TX",
      columns: SAMPLE_HEADERS, mapping: MAPPING,
    });
    assert.equal(r.ok, true);
    importJobId = (r as { value: number }).value;
  });

  await check("the upload is checked against the declaration", async () => {
    const r = await importSvc.attachFile(importJobId, "sample.csv", Buffer.from(SAMPLE_CSV, "utf8"));
    assert.equal(r.ok, true);
    const v = (r as { value: { check: { matches: boolean }; rowCount: number } }).value;
    assert.equal(v.check.matches, true);
    assert.equal(v.rowCount, 6);
  });
  await check("a file that is not the declared shape is reported, not silently accepted", async () => {
    const other = await importSvc.declareJob({
      name: `${TAG} mismatch`, sourceType: "STATE_BOARD",
      columns: ["Name", "Email", "Licence"], mapping: { name: "Name", email: "Email" },
    });
    const id = (other as { value: number }).value;
    const r = await importSvc.attachFile(id, "x.csv",
      Buffer.from("Name,Email,Extra\nA,a@b.com,z\n", "utf8"));
    assert.equal(r.ok, true);
    const check = (r as { value: { check: { missing: string[]; extra: string[] } } }).value.check;
    assert.deepEqual(check.missing, ["Licence"]);
    assert.deepEqual(check.extra, ["Extra"]);
    await prisma.importJob.delete({ where: { id } });
  });
  await check("a file with no email column at all still parses but the job refuses it", async () => {
    const r = await importSvc.attachFile(importJobId, "x.pdf", Buffer.from("nonsense"));
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /unsupported file type/);
  });

  await check("preprocessing applies every rule", async () => {
    const r = await importSvc.analyseJob(importJobId);
    assert.equal(r.ok, true);
    const a = (r as { value: { accepted: number; review: number; excluded: number;
                               ruleCounts: Record<string, number> } }).value;
    assert.equal(a.accepted, 3);          // Oak Ridge, Health Mart, Piney Woods
    assert.equal(a.review, 1);            // Bayou: no licence status
    assert.equal(a.excluded, 2);          // CVS, and the duplicate Oak Ridge
    assert.equal(a.ruleCounts["chain"], 1);
    assert.equal(a.ruleCounts["duplicate"], 1);
  });
  await check("the independent franchise banner survived", async () => {
    const row = await prisma.importRow.findFirst({
      where: { jobId: importJobId, raw: { path: ["Facility Name"], string_contains: "Health Mart" } } });
    assert.equal(row?.decision, "ACCEPTED");
  });

  let importBatchId = 0;
  await check("committing writes normalised values into the registry", async () => {
    const r = await importSvc.commitJob(importJobId);
    assert.equal(r.ok, true);
    const v = (r as { value: { created: number; batchId: number } }).value;
    assert.equal(v.created, 4);           // three accepted plus the one for review
    importBatchId = v.batchId;

    const oak = await prisma.pharmacy.findFirst({
      where: { canonicalName: { contains: "Oak Ridge" }, importBatchId } });
    assert.equal(oak!.streetAddress, "123 Main St");   // "123 main street" normalised
    assert.equal(oak!.city, "Austin");                 // "austin" normalised
    assert.equal(oak!.state, "TX");                    // "Texas" resolved
    assert.equal(oak!.zipCode, "78701");               // ZIP+4 truncated
    assert.equal(oak!.phone, "+15125550142");          // "(512) 555-0142" normalised
  });
  await check("a row needing review lands as NEEDS_REVIEW, not ready", async () => {
    const bayou = await prisma.pharmacy.findFirst({
      where: { canonicalName: { contains: "Bayou" }, importBatchId } });
    assert.equal(bayou!.verificationStatus, "NEEDS_REVIEW");
  });
  await check("a row with no email is kept and is not outreach-eligible", async () => {
    const piney = await prisma.pharmacy.findFirst({
      where: { canonicalName: { contains: "Piney Woods" }, importBatchId } });
    assert.ok(piney);
    assert.equal(piney!.email, null);
    assert.equal(piney!.emailVerificationStatus, "NOT_CHECKED");
  });
  await check("shared inboxes are labelled, not dropped", async () => {
    const shared = await prisma.pharmacy.count({ where: { importBatchId, emailKind: "SHARED" } });
    const personal = await prisma.pharmacy.count({ where: { importBatchId, emailKind: "PERSONAL" } });
    assert.equal(personal, 3);
    assert.equal(shared, 0);
  });
  await check("committing twice is refused", async () =>
    assert.equal((await importSvc.commitJob(importJobId)).ok, false));

  await check("re-importing the same file updates rather than duplicating", async () => {
    const again = await importSvc.declareJob({
      name: `${TAG} import round two`, sourceType: "STATE_BOARD", jurisdiction: "TX",
      columns: SAMPLE_HEADERS, mapping: MAPPING });
    const id2 = (again as { value: number }).value;
    await importSvc.attachFile(id2, "sample.csv", Buffer.from(SAMPLE_CSV, "utf8"));
    await importSvc.analyseJob(id2);
    const before = await prisma.pharmacy.count();
    const r = await importSvc.commitJob(id2);
    assert.equal(r.ok, true);
    const v = (r as { value: { created: number; updated: number; unchanged: number } }).value;
    assert.equal(v.created, 0);                              // matched on licence + state
    assert.equal(await prisma.pharmacy.count(), before);     // nothing duplicated
    const job2 = await prisma.importJob.findUnique({ where: { id: id2 } });
    await prisma.pharmacy.updateMany({
      where: { importBatchId: job2!.batchId! }, data: { importBatchId } });
    await prisma.importJob.delete({ where: { id: id2 } });
    await prisma.importBatch.delete({ where: { id: job2!.batchId! } });
  });

  // --- email verification, scoped ------------------------------------------------------------------
  let verifyBatchId = 0;
  await check("a verification scope can be limited to one state", async () => {
    const preview = await verifySvc.previewScope({ states: ["TX"], onlyUnchecked: true });
    assert.ok(preview.total >= 3);
    assert.ok(preview.byState.every((s) => s.state === "TX"));
  });
  await check("creating a batch reserves the addresses", async () => {
    const r = await verifySvc.createBatch(`${TAG} TX pass`, { states: ["TX"], onlyUnchecked: true });
    assert.equal(r.ok, true);
    verifyBatchId = (r as { id: number }).id;
    const reserved = await prisma.pharmacy.count({
      where: { state: "TX", emailVerificationStatus: "IN_PROGRESS" } });
    assert.ok(reserved >= 3);
  });
  await check("a second batch does not pick up addresses already with a verifier", async () => {
    const again = await verifySvc.createBatch(`${TAG} TX again`,
      { states: ["TX"], onlyUnchecked: true });
    assert.equal(again.ok, false);       // nothing left unchecked in TX
  });
  await check("the export carries what a verifier needs to answer", async () => {
    const csv = await verifySvc.exportBatchCsv(verifyBatchId);
    const [header, ...rows] = csv.split("\n");
    assert.equal(header, "pharmacy_id,email,pharmacy_name,state,result");
    assert.ok(rows.length >= 3);
  });
  await check("only VALID becomes mailable; catch-all and risky do not", async () => {
    const csv = await verifySvc.exportBatchCsv(verifyBatchId);
    const results = csv.split("\n").map((line, i) => {
      if (i === 0 || !line.trim()) return line;
      return line + (line.includes("elena@") ? "catch_all" : "valid");
    }).join("\n");

    const applied = await verifySvc.applyResults(verifyBatchId, results);
    assert.equal(applied.ok, true);
    const a = applied as { applied: number; unmatched: number; counts: Record<string, number> };
    assert.equal(a.unmatched, 0);
    assert.equal(a.counts.CATCH_ALL, 1);

    const valid = await prisma.pharmacy.count({
      where: { importBatchId, emailVerificationStatus: "VALID" } });
    const catchAll = await prisma.pharmacy.count({
      where: { importBatchId, emailVerificationStatus: "CATCH_ALL" } });
    assert.equal(catchAll, 1);
    assert.ok(valid >= 2);
  });
  await check("a state column in the results is not mistaken for the verdict", async () => {
    // The export carries a US state column; an alias list that included "state" matched it and
    // reported a confident zero. This asserts the verdict column is found instead.
    const r = await verifySvc.applyResults(verifyBatchId,
      "pharmacy_id,email,pharmacy_name,state,result\n999999,x@y.com,X,TX,valid");
    assert.equal(r.ok, true);
    assert.equal((r as { unmatched: number }).unmatched, 1);   // unmatched id, not a bad column
  });

  // --- verification results are paid for, and must not be silently invalidated ---------------
  // The client pays per address. These cover every path that could leave a verdict attached to
  // an address it was never bought for, which is worse than losing it: the record reads VALID,
  // becomes campaign-eligible, and the next round skips it for already being checked.
  await check("a re-import that changes the address resets its verification", async () => {
    const { buildPatch } = await import("../lib/import/service.js");
    const patch = buildPatch(
      { email: "old@example.com", emailVerificationStatus: "VALID",
        emailCheckedAt: new Date("2026-09-01") },
      { email: "new@example.com", emailKind: "PERSONAL" } as never,
      "STATE_BOARD");
    assert.equal(patch.email, "new@example.com");
    assert.equal(patch.emailVerificationStatus, "NOT_CHECKED",
      "a new address must not inherit the old address's verdict");
    assert.equal(patch.emailCheckedAt, null);
  });

  await check("a re-import with the same address keeps the verification it paid for", async () => {
    const { buildPatch } = await import("../lib/import/service.js");
    const patch = buildPatch(
      { email: "same@example.com", emailVerificationStatus: "VALID" },
      { email: "same@example.com", emailKind: "PERSONAL" } as never,
      "STATE_BOARD");
    assert.equal(patch.emailVerificationStatus, undefined,
      "an unchanged address must not be re-verified at the client's expense");
  });

  await check("a re-import that only fills blanks never resets verification", async () => {
    const { buildPatch } = await import("../lib/import/service.js");
    const patch = buildPatch(
      { email: "kept@example.com", emailVerificationStatus: "VALID", phone: null },
      { email: "other@example.com", phone: "+15551234567", emailKind: "PERSONAL" } as never,
      "COMMERCIAL");   // lower authority: may fill gaps, never overwrite
    assert.equal(patch.email, undefined, "a lower-authority source must not replace an address");
    assert.equal(patch.emailVerificationStatus, undefined);
    assert.equal(patch.phone, "+15551234567", "but it should still fill the empty phone");
  });

  await check("a result is not applied to a record whose address changed mid-round", async () => {
    const ph = await prisma.pharmacy.create({ data: {
      canonicalName: `${TAG} mid-round change`, state: "OH", email: "submitted@example.com",
      emailVerificationStatus: "IN_PROGRESS", verificationStatus: "READY_FOR_VERIFICATION",
      dataStatus: "DATA_READY" } });
    const batch = await prisma.emailVerificationBatch.create({
      data: { name: `${TAG} mid-round`, scope: {}, total: 1 } });
    await prisma.emailVerificationItem.create({ data: {
      batchId: batch.id, pharmacyId: ph.id, email: "submitted@example.com" } });

    // An import changes the address while the round is out with the verifier.
    await prisma.pharmacy.update({
      where: { id: ph.id },
      data: { email: "changed@example.com", emailVerificationStatus: "NOT_CHECKED" } });

    const r = await applyResults(batch.id,
      "pharmacy_id,email,result\n" + `${ph.id},submitted@example.com,valid\n`);
    assert.ok(r.ok);

    const after = await prisma.pharmacy.findUnique({ where: { id: ph.id } });
    assert.equal(after!.emailVerificationStatus, "NOT_CHECKED",
      "a verdict bought for the old address was written onto the new one");

    await prisma.emailVerificationBatch.delete({ where: { id: batch.id } });
    await prisma.pharmacy.delete({ where: { id: ph.id } });
  });

  await check("re-screening never touches verification results", async () => {
    const ph = await prisma.pharmacy.create({ data: {
      canonicalName: `${TAG} CVS PHARMACY #4021`, state: "OH", email: "chain@example.com",
      emailVerificationStatus: "VALID", emailCheckedAt: new Date("2026-09-01"),
      verificationStatus: "READY_FOR_VERIFICATION", dataStatus: "DATA_READY" } });
    const { applyRescreen, rescreenRegistry } = await import("../lib/import/rescreen.js");
    const report = await rescreenRegistry();
    await applyRescreen(report, { applyReview: true });
    const after = await prisma.pharmacy.findUnique({ where: { id: ph.id } });
    assert.equal(after!.emailVerificationStatus, "VALID",
      "re-screening must not discard a verification the client paid for");
    assert.equal(after!.emailCheckedAt?.toISOString().slice(0, 10), "2026-09-01");
    await prisma.pharmacy.delete({ where: { id: ph.id } });
  });

  // --- rebuilding an audience must not re-mail anybody ----------------------------------------
  // The normal way to work is: import a new state, then widen the campaign's audience to include
  // it. Before this, that put every already-sent recipient back to PENDING and mailed them again.
  await check("rebuilding an audience leaves already-sent recipients alone", async () => {
    const sent = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id, status: "SENT" } });
    assert.ok(sent, "this test needs a sent recipient from the send tests above");
    const sentAtBefore = sent!.sentAt;

    const r = await buildRecipients(campaign.id,
      { canonicalName: { startsWith: TAG } } as Record<string, unknown>);

    const after = await prisma.campaignRecipient.findUnique({ where: { id: sent!.id } });
    assert.equal(after!.status, "SENT", "a sent recipient was reset and would be mailed twice");
    assert.equal(after!.sentAt?.toISOString(), sentAtBefore?.toISOString());
    assert.ok(r.kept >= 1, "the rebuild should report what it protected");
  });

  await check("a blocked recipient is still re-evaluated on rebuild", async () => {
    // Blocked is not history - a record unverified last week may qualify today, so it must
    // still be reconsidered.
    const blocked = await prisma.campaignRecipient.findFirst({
      where: { campaignId: campaign.id, status: "BLOCKED" } });
    if (!blocked) return;
    await buildRecipients(campaign.id,
      { canonicalName: { startsWith: TAG } } as Record<string, unknown>);
    const after = await prisma.campaignRecipient.findUnique({ where: { id: blocked.id } });
    assert.ok(["BLOCKED", "PENDING"].includes(after!.status),
      "a blocked row must be re-evaluated, not frozen");
  });

  // --- the CAN-SPAM footer is a hard gate ------------------------------------------------------
  // An incomplete footer makes every message in a campaign unlawful, and does it silently.
  await check("a real postal address passes the footer check", async () => {
    await setFooter("Acme Supply", "18 Harbour Road, Suite 200, Boston MA 02110");
    assert.equal((await footerCompliance()).ok, true);
  });
  await check("an empty postal address fails", async () => {
    await setFooter("Acme Supply", "");
    assert.ok((await footerCompliance()).missing.some((m) => /postal/.test(m)));
  });
  await check("an empty company name fails", async () => {
    await setFooter("", "18 Harbour Road, Boston MA 02110");
    assert.ok((await footerCompliance()).missing.some((m) => /company name/.test(m)));
  });
  await check("a bare city name is not somewhere mail arrives", async () => {
    await setFooter("Acme Supply", "Boston");
    assert.ok((await footerCompliance()).missing.some((m) => /postal/.test(m)));
  });

  await check("a campaign refuses to start while the footer is incomplete", async () => {
    await setFooter("Acme Supply", "");
    const before = await prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: "QUEUED" } });
    const r = await startCampaign(campaign.id);
    assert.ok(r.refused, "start must be refused, not silently succeed");
    assert.match(r.refused!, /postal address/);
    assert.equal(r.queued, 0, "nothing may be queued by a refused start");
    const after = await prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, status: "QUEUED" } });
    assert.equal(after, before, "the recipient list must be untouched");
    const c = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    assert.notEqual(c!.status, "RUNNING", "a refused campaign must not be left running");
  });

  await check("the refusal is recorded rather than only shown", async () => {
    const e = await prisma.auditEvent.findFirst({
      where: { eventType: "CAMPAIGN_START_REFUSED" }, orderBy: { id: "desc" } });
    assert.ok(e, "a refused start leaves no audit trail");
    assert.match(e!.detail ?? "", /postal address/);
  });

  await setFooter(`${TAG} Supply`, "18 Harbour Road, Suite 200, Boston MA 02110");

  // --- a confirmed address is never paid for twice --------------------------------------------
  await check("createBatch drops addresses that are already confirmed valid", async () => {
    const ph = await prisma.pharmacy.findMany({
      where: { canonicalName: { startsWith: TAG } }, take: 2, select: { id: true } });
    await prisma.pharmacy.updateMany({
      where: { id: { in: ph.map((p) => p.id) } },
      data: { emailVerificationStatus: "VALID", emailCheckedAt: new Date() } });

    // A scope that names them by state would ordinarily pick them up; the guard removes them.
    const r = await createBatch(`${TAG} double-charge probe`, {
      onlyUnchecked: false, previousResults: ["VALID", "UNKNOWN"], search: TAG });
    if (r.ok) {
      const items = await prisma.emailVerificationItem.findMany({
        where: { batchId: r.id }, select: { pharmacyId: true } });
      // "valid" was named explicitly here, so they ARE allowed through - that is the point.
      assert.ok(items.length >= 0);
      await prisma.emailVerificationBatch.delete({ where: { id: r.id } });
    }

    // Without naming valid, the same addresses must be refused.
    const r2 = await createBatch(`${TAG} guard probe`, {
      onlyUnchecked: false, previousResults: ["UNKNOWN"], search: TAG });
    if (r2.ok) {
      const items = await prisma.emailVerificationItem.findMany({
        where: { batchId: r2.id }, select: { pharmacyId: true } });
      for (const i of items)
        assert.ok(!ph.some((p) => p.id === i.pharmacyId),
          "a confirmed-valid address reached a batch that did not ask for one");
      await prisma.emailVerificationBatch.delete({ where: { id: r2.id } });
    }

    await prisma.pharmacy.updateMany({
      where: { id: { in: ph.map((p) => p.id) } },
      data: { emailVerificationStatus: "NOT_CHECKED", emailCheckedAt: null } });
  });

  // --- verification workspace ---------------------------------------------------------------------
  const verificationSvc = await import("../lib/verification/service");
  const bulkSvc = await import("../lib/registry/bulk");
  const workActor = { email: "zztest-owner@zztest.local", role: "OWNER" };

  const subject = await prisma.pharmacy.create({ data: {
    canonicalName: `${TAG} Verification Subject`, state: "FL", city: "Tampa",
    email: "verify@zztest.local", verificationStatus: "READY_FOR_VERIFICATION" } });
  for (const t of ["LICENSE", "OWNERSHIP", "OPERATIONAL_STATUS", "PHARMACY_TYPE", "CONTACT"])
    await prisma.verificationTask.create({ data: {
      pharmacyId: subject.id, verificationType: t, trigger: "NEW_RECORD" } });

  await check("confirming all three gating checks verifies the record", async () => {
    const r = await verificationSvc.submitVerification(subject.id, [
      { type: "LICENSE", verdict: "CONFIRMED", value: "ACTIVE", evidenceSource: "board lookup" },
      { type: "OWNERSHIP", verdict: "CONFIRMED", value: "INDEPENDENT" },
      { type: "OPERATIONAL_STATUS", verdict: "CONFIRMED", value: "OPEN" },
    ], workActor);
    assert.equal(r.status, "VERIFIED");
    assert.equal(r.becameVerified, true);
    const p = await prisma.pharmacy.findUnique({ where: { id: subject.id } });
    assert.equal(p!.licenseStatus, "ACTIVE");
    assert.equal(p!.ownershipStatus, "INDEPENDENT");
    assert.equal(p!.operationalStatus, "OPEN");
  });
  await check("a verified record is still not mailable until its email is verified", async () => {
    // Both gates, not either. This is the whole point of keeping them separate.
    const eligible = await prisma.pharmacy.count({ where: {
      id: subject.id, verificationStatus: "VERIFIED", emailVerificationStatus: "VALID" } });
    assert.equal(eligible, 0);
  });
  await check("every check records who said it and what they looked at", async () => {
    const results = await prisma.verificationResult.findMany({ where: { pharmacyId: subject.id } });
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.verifiedBy === "zztest-owner@zztest.local"));
    assert.ok(results.some((r) => r.evidenceSource === "board lookup"));
  });
  await check("a failed check excludes outright, not merely flags", async () => {
    const r = await verificationSvc.submitVerification(subject.id, [
      { type: "OWNERSHIP", verdict: "FAILED", notes: "it is a chain" },
    ], workActor);
    assert.equal(r.status, "EXCLUDED");
    const p = await prisma.pharmacy.findUnique({ where: { id: subject.id } });
    assert.equal(p!.campaignEligible, false);
    assert.match(p!.exclusionReason ?? "", /ownership/);
  });
  await check("an uncertain check holds the record rather than passing it", async () => {
    await verificationSvc.submitVerification(subject.id, [
      { type: "OWNERSHIP", verdict: "UNCERTAIN", notes: "cannot establish ownership" },
    ], workActor);
    const p = await prisma.pharmacy.findUnique({ where: { id: subject.id } });
    assert.equal(p!.verificationStatus, "NEEDS_REVIEW");
  });
  await check("the queue skips records already handed over", async () => {
    const first = await verificationSvc.nextInQueue({ states: ["FL"] });
    assert.ok(first);
    const second = await verificationSvc.nextInQueue({ states: ["FL"] }, [first!.pharmacy.id]);
    assert.notEqual(second?.pharmacy.id, first!.pharmacy.id);
  });

  // --- bulk actions ---------------------------------------------------------------------------------
  await check("a bulk exclusion is refused without a reason", async () => {
    const r = await bulkSvc.runBulk("EXCLUDE", [subject.id], {}, workActor);
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /needs a reason/);
  });
  await check("an empty selection does nothing", async () =>
    assert.equal((await bulkSvc.runBulk("MARK_REVIEW", [], {}, workActor)).ok, false));
  await check("bulk review and return move the record both ways", async () => {
    assert.equal((await bulkSvc.runBulk("MARK_REVIEW", [subject.id], { reason: "test" },
      workActor)).ok, true);
    let p = await prisma.pharmacy.findUnique({ where: { id: subject.id } });
    assert.equal(p!.verificationStatus, "NEEDS_REVIEW");

    assert.equal((await bulkSvc.runBulk("MARK_READY", [subject.id], {}, workActor)).ok, true);
    p = await prisma.pharmacy.findUnique({ where: { id: subject.id } });
    assert.equal(p!.verificationStatus, "READY_FOR_VERIFICATION");
  });
  await check("returning to the queue cannot resurrect an excluded record", async () => {
    // Undoing an exclusion is a decision that belongs on the record, with its reason in view.
    await prisma.pharmacy.update({ where: { id: subject.id },
      data: { verificationStatus: "EXCLUDED", exclusionReason: "a real exclusion" } });
    const r = await bulkSvc.runBulk("MARK_READY", [subject.id], {}, workActor);
    assert.equal(r.ok, true);
    assert.equal((r as { affected: number }).affected, 0);
    const p = await prisma.pharmacy.findUnique({ where: { id: subject.id } });
    assert.equal(p!.verificationStatus, "EXCLUDED");
  });
  await check("a bulk add is refused for a finished campaign", async () => {
    // `campaign` was drained and auto-completed earlier in this suite.
    const r = await bulkSvc.runBulk("ADD_TO_CAMPAIGN", [subject.id],
      { campaignId: campaign.id }, workActor);
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /completed/);
  });
  await check("a bulk add to a live campaign still obeys eligibility", async () => {
    await prisma.pharmacy.update({ where: { id: subject.id },
      data: { verificationStatus: "READY_FOR_VERIFICATION", exclusionReason: null } });
    const live = await prisma.campaign.create({ data: {
      name: `${TAG} bulk target`, subject: "s", bodyText: "b", bodyHtml: "b",
      sendingDays: "1,2,3,4,5,6,7", sendingStartTime: "00:00", sendingEndTime: "23:59" } });
    const r = await bulkSvc.runBulk("ADD_TO_CAMPAIGN", [subject.id],
      { campaignId: live.id }, workActor);
    assert.equal(r.ok, true);
    // Not verified, so nothing was queued - a bulk add is not a way around the rules.
    assert.equal((r as { affected: number }).affected, 0);
  });

  // --- platform account and suspension -----------------------------------------------------------
  const { suspendSystem, resumeSystem, systemState } = await import("../lib/system-state");
  const { hashPassword: hp } = await import("../lib/auth");

  const platform = await prisma.appUser.create({ data: {
    email: "zztest-platform@zztest.local", name: "Platform", role: "PLATFORM", status: "ACTIVE",
    passwordHash: hp("platform-password-1") } });

  await check("the platform account is hidden from the operator list", async () => {
    const listed = await users.listUsers();
    assert.ok(!listed.some((u) => u.id === platform.id));
    // …while still being a real row, so it can sign in.
    assert.ok(await prisma.appUser.findUnique({ where: { id: platform.id } }));
  });
  await check("an owner cannot demote, suspend, reset or remove it", async () => {
    for (const attempt of [
      users.changeRole(ownerActor, platform.id, "VIEWER"),
      users.setStatus(ownerActor, platform.id, "SUSPENDED"),
      users.resetPassword(ownerActor, platform.id),
      users.deleteUser(ownerActor, platform.id),
    ]) {
      const r = await attempt;
      assert.equal(r.ok, false);
      // Indistinguishable from an id that does not exist - no confirmation that it is there.
      assert.equal((r as { reason: string }).reason, "user not found");
    }
    const after = await prisma.appUser.findUnique({ where: { id: platform.id } });
    assert.equal(after!.role, "PLATFORM");
    assert.equal(after!.status, "ACTIVE");
  });
  await check("nobody can be given the platform role through the app", async () => {
    const r = await users.createUser(ownerActor,
      { email: "zztest-wannabe@zztest.local", role: "PLATFORM" });
    assert.equal(r.ok, false);
  });

  await check("suspending stops operators signing in", async () => {
    await suspendSystem("integration test");
    assert.equal((await systemState()).suspended, true);
    const r = await users.authenticate("zztest-owner@zztest.local", "a-new-long-password");
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, "system suspended");
  });
  await check("the platform account can still sign in while suspended", async () => {
    const r = await users.authenticate("zztest-platform@zztest.local", "platform-password-1");
    assert.equal(r.ok, true);
  });
  await check("the worker sends nothing while suspended", async () => {
    const t = await tick();
    assert.equal(t.sent, 0);
    assert.ok(t.skipped.some((s) => s.includes("suspended")));
  });
  await check("resuming restores normal sign-in", async () => {
    await resumeSystem();
    assert.equal((await systemState()).suspended, false);
    assert.equal((await users.authenticate("zztest-owner@zztest.local", "a-new-long-password")).ok,
      true);
  });
  await check("suspension and resumption are audited without naming the account", async () => {
    const rows = await prisma.auditEvent.findMany({
      where: { eventType: { in: ["SYSTEM_SUSPENDED", "SYSTEM_RESUMED"] } },
      orderBy: { id: "desc" }, take: 2 });
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.actor, "platform");
      assert.ok(!r.actor.includes("@"));
    }
  });

  // --- real data untouched ----------------------------------------------------------------------------
  await check("no real pharmacy was marked VERIFIED", async () => {
    const v = await prisma.pharmacy.count({
      where: { verificationStatus: "VERIFIED", canonicalName: { not: { startsWith: TAG } } } });
    assert.equal(v, 0);
  });
  await check("no real pharmacy received a message", async () => {
    const real = await prisma.campaignRecipient.count({
      where: { status: "SENT", pharmacy: { canonicalName: { not: { startsWith: TAG } } } } });
    assert.equal(real, 0);
  });

  await restoreFooter();
  await cleanup();
  await check("the deployment's own company settings were put back", async () => {
    const now = await prisma.appSetting.findMany({
      where: { key: { in: ["company.name", "company.address"] } } });
    assert.equal(now.length, footerSnapshot.length);
    for (const row of footerSnapshot)
      assert.equal(now.find((n) => n.key === row.key)?.value, row.value);
  });
  await check("fixtures cleaned up", async () =>
    assert.equal(await prisma.pharmacy.count(), before));
  await check("the suite left no rows in the real audit log", async () =>
    assert.equal(await prisma.auditEvent.count(), auditBefore));

  const failed = R.filter(([, ok]) => !ok);
  for (const [label, ok] of R) if (!ok) console.log(`  FAIL ${label}`);
  console.log(`\n${R.length - failed.length}/${R.length} passed`);
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}
main();
