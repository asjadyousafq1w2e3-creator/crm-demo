/**
 * Campaign business logic. No auth and no Next request scope, so the worker and the
 * tests can call these directly. Authentication lives in actions.ts.
 */
import { prisma } from "../db";
import { checkPharmacy } from "./eligibility";
import { config } from "../config";
import { globalHeadroom, remainingToday, totalCapacityToday, unusableReason } from "./router";
import { actorFields, type Actor } from "../audit";
import { footerCompliance, footerProblem } from "../settings";

const audit = (eventType: string, detail?: string, actor?: Actor, pharmacyId?: number) =>
  prisma.auditEvent.create({ data: { eventType, detail, pharmacyId, ...actorFields(actor) } });

/** Build the recipient set. Eligibility is evaluated here AND again before each send. */
export async function buildRecipients(
  campaignId: number, where: Record<string, unknown>, actor?: Actor, limit?: number) {
  const pharmacies = await prisma.pharmacy.findMany({
    where, take: limit, orderBy: { id: "asc" }, select: {
      id: true, email: true, verificationStatus: true, licenseStatus: true,
      operationalStatus: true, ownershipStatus: true, emailVerificationStatus: true,
    },
  });
  const emails = pharmacies.map((p) => p.email).filter(Boolean) as string[];
  const suppressed = new Set((await prisma.suppressionEntry.findMany({
    where: { email: { in: emails.map((e) => e.toLowerCase()) } }, select: { email: true },
  })).map((s) => s.email));

  /*
   * Anyone this campaign has already acted on is left exactly as they are.
   *
   * Rebuilding used to overwrite every matched row, which meant a campaign that had already sent
   * to eight hundred pharmacies would put all eight hundred back to PENDING and mail them a
   * second time. That is not a hypothetical: the normal way to work is to add a state to the
   * registry and widen the audience to include it, and doing that on a live campaign would have
   * re-sent everything that came before.
   *
   * PENDING and BLOCKED are re-evaluated, because a record blocked for being unverified last
   * week may legitimately qualify today. Everything else is history and stays put.
   */
  const ALREADY_ACTIONED = ["QUEUED", "SCHEDULED", "SENDING", "SENT", "FAILED",
                            "REPLIED", "BOUNCED", "UNSUBSCRIBED", "CANCELLED"];
  const untouchable = new Set((await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { in: ALREADY_ACTIONED } },
    select: { pharmacyId: true },
  })).map((r) => r.pharmacyId));

  let eligible = 0, blocked = 0, kept = 0;
  for (const p of pharmacies) {
    if (untouchable.has(p.id)) { kept++; continue; }
    const reason = !p.email ? "no email address"
      : suppressed.has(p.email.toLowerCase()) ? "suppressed"
      : checkPharmacy(p).eligible ? null : checkPharmacy(p).reason;
    await prisma.campaignRecipient.upsert({
      where: { campaignId_pharmacyId: { campaignId, pharmacyId: p.id } },
      update: {
        status: reason ? "BLOCKED" : "PENDING", blockReason: reason,
        recipientEmail: p.email ?? "",
      },
      create: {
        campaignId, pharmacyId: p.id, recipientEmail: p.email ?? "",
        status: reason ? "BLOCKED" : "PENDING", blockReason: reason,
        idempotencyKey: `c${campaignId}-p${p.id}`,
      },
    });
    if (reason) blocked++; else eligible++;
  }
  await audit("CAMPAIGN_UPDATED",
    `recipients rebuilt: ${eligible} eligible, ${blocked} blocked`
    + (kept ? `, ${kept} already contacted and left alone` : ""), actor);
  return { eligible, blocked, kept, total: pharmacies.length };
}

export async function startCampaign(campaignId: number, actor?: Actor) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("campaign not found");

  // Refused before anything is queued. An incomplete footer is not a cosmetic problem - it makes
  // every message in the campaign unlawful, and the failure is silent, so the only useful place
  // to catch it is the moment somebody presses start.
  const footer = await footerCompliance();
  if (!footer.ok) {
    await audit("CAMPAIGN_START_REFUSED", footerProblem(footer) ?? "footer incomplete", actor);
    return { queued: 0, blocked: 0, refused: footerProblem(footer)! };
  }

  // Queue only recipients that pass eligibility right now.
  const pending = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    include: { pharmacy: {
      select: { id: true, email: true, verificationStatus: true, licenseStatus: true,
                operationalStatus: true, ownershipStatus: true, emailVerificationStatus: true } } },
  });
  let queued = 0, blocked = 0;
  for (const r of pending) {
    const verdict = checkPharmacy(r.pharmacy);
    if (!verdict.eligible) {
      await prisma.campaignRecipient.update({
        where: { id: r.id }, data: { status: "BLOCKED", blockReason: verdict.reason } });
      blocked++; continue;
    }
    await prisma.campaignRecipient.update({
      where: { id: r.id }, data: { status: "QUEUED", queuedAt: new Date() } });
    await prisma.pharmacy.update({ where: { id: r.pharmacyId }, data: { leadStatus: "QUEUED" } });
    queued++;
  }
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: queued ? "RUNNING" : "READY", startedAt: queued ? new Date() : null },
  });
  await audit("CAMPAIGN_STARTED", `${queued} queued, ${blocked} blocked`, actor);
  return { queued, blocked, refused: null as string | null };
}

export async function setCampaignStatus(
  campaignId: number, status: "PAUSED" | "RUNNING" | "CANCELLED", actor?: Actor) {
  const field = status === "PAUSED" ? { pausedAt: new Date() }
    : status === "CANCELLED" ? { cancelledAt: new Date() } : {};
  await prisma.campaign.update({ where: { id: campaignId }, data: { status, ...field } });
  if (status === "CANCELLED") {
    await prisma.campaignRecipient.updateMany({
      where: { campaignId, status: { in: ["PENDING", "QUEUED", "SCHEDULED"] } },
      data: { status: "CANCELLED" },
    });
  }
  await audit(`CAMPAIGN_${status}`, `campaign ${campaignId}`, actor);
}

export async function campaignReview(campaignId: number) {
  const [campaign, counts, allMailboxes, pool] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId } }),
    prisma.campaignRecipient.groupBy({
      by: ["status"], where: { campaignId }, _count: true }),
    prisma.mailbox.findMany({ orderBy: { id: "asc" } }),
    prisma.campaignMailbox.findMany({ where: { campaignId }, select: { mailboxId: true } }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const blockedReasons = await prisma.campaignRecipient.groupBy({
    by: ["blockReason"], where: { campaignId, status: "BLOCKED" }, _count: true });

  // An empty pool means "any mailbox", so the effective set is the whole list.
  const poolIds = new Set(pool.map((p) => p.mailboxId));
  const sending = poolIds.size ? allMailboxes.filter((m) => poolIds.has(m.id)) : allMailboxes;

  const capacity = totalCapacityToday(sending);
  const pending = n("PENDING");

  // Status for EVERY mailbox, not just the pool: the picker shows all of them, and a mailbox
  // left out of the pool must read as "not selected" rather than as one with no capacity.
  const mailboxStatus = allMailboxes.map((m) => ({
    id: m.id, email: m.emailAddress, status: m.status, rampStage: m.rampStage,
    remaining: remainingToday(m), blockedReason: unusableReason(m),
    inPool: !poolIds.size || poolIds.has(m.id),
    window: `${m.sendingStartTime}–${m.sendingEndTime} ${m.timezone}`,
  }));

  // Recipients already tied to a mailbox by an earlier conversation.
  const assigned = await prisma.pharmacy.groupBy({
    by: ["assignedMailboxId"],
    where: { assignedMailboxId: { not: null }, campaignRecipients: { some: { campaignId } } },
    _count: true,
  });

  return {
    campaign, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    eligible: pending, blocked: n("BLOCKED"),
    blockedReasons: blockedReasons.map((b) => ({ reason: b.blockReason ?? "unknown", count: b._count })),
    mailboxes: sending, allMailboxes, poolIds: [...poolIds], poolIsExplicit: poolIds.size > 0,
    mailboxStatus,
    assignedCounts: assigned.map((a) => ({
      mailboxId: a.assignedMailboxId!, count: a._count,
      email: allMailboxes.find((m) => m.id === a.assignedMailboxId)?.emailAddress ?? "removed mailbox",
    })),
    dailyCapacity: capacity,
    accountHeadroom: globalHeadroom(allMailboxes),
    // Only meaningful when there is something queued to send.
    estimatedDays: pending > 0 && capacity > 0
      ? Math.ceil(pending / Math.min(capacity, campaign?.dailyLimit ?? capacity))
      : null,
    emailMode: config.emailMode, liveEnabled: config.liveSendingEnabled,
  };
}

/** Replace a campaign's sending pool. An empty selection restores "any eligible mailbox". */
export async function setCampaignPool(campaignId: number, mailboxIds: number[], actor?: Actor) {
  await prisma.$transaction([
    prisma.campaignMailbox.deleteMany({ where: { campaignId } }),
    prisma.campaignMailbox.createMany({
      data: mailboxIds.map((mailboxId) => ({ campaignId, mailboxId })), skipDuplicates: true }),
  ]);
  await audit("CAMPAIGN_POOL_CHANGED",
    mailboxIds.length ? `${mailboxIds.length} mailbox(es) selected` : "any eligible mailbox", actor);
}

export async function setUseAssignedMailbox(
  campaignId: number, useAssigned: boolean, actor?: Actor) {
  await prisma.campaign.update({
    where: { id: campaignId }, data: { useAssignedMailbox: useAssigned } });
  await audit("CAMPAIGN_UPDATED",
    `keep the same sender per pharmacy: ${useAssigned ? "on" : "off"}`, actor);
}

