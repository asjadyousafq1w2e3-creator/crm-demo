/**
 * Inbox business logic: replying from the CRM, lead classification and follow-ups.
 * No auth and no request scope here - actions.ts adds those.
 */
import { prisma } from "../db";
import { isCrmShowcase } from "../showcase-mode";
import { config, liveRecipientAllowed, liveSendingAllowed } from "../config";
import { providerFor } from "../mail";
import { newRfcMessageId } from "../mail/types";
import { suppress } from "../campaign/suppression";
import { actorFields, type Actor } from "../audit";

export const LEAD_STATUSES = [
  "NOT_CONTACTED", "SENT", "REPLIED", "INTERESTED", "NOT_INTERESTED",
  "FOLLOW_UP", "BOUNCED", "UNSUBSCRIBED", "CLOSED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type ReplyResult = { ok: true; providerMessageId: string } | { ok: false; reason: string };

/**
 * Send a reply on an existing thread. A reply is a send, so it passes the same live-sending
 * gate as a campaign message - nothing leaves the application unless both switches are on.
 */
export async function replyToConversation(
  conversationId: number, bodyText: string, actor?: Actor,
): Promise<ReplyResult> {
  const body = bodyText.trim();
  if (!body) return { ok: false, reason: "empty message" };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { mailbox: true, messages: { orderBy: { id: "desc" }, take: 20 } },
  });
  if (!conversation) return { ok: false, reason: "conversation not found" };
  const { mailbox } = conversation;
  if (mailbox.status === "DISCONNECTED")
    return { ok: false, reason: "the mailbox for this thread is disconnected" };

  if (config.emailMode === "gmail") {
    const live = liveSendingAllowed();
    if (!live.allowed) return { ok: false, reason: `live sending disabled: ${live.reason}` };
    if (!liveRecipientAllowed(conversation.contactEmail))
      return { ok: false, reason: "live mode: address is not on LIVE_EMAIL_TEST_ALLOWLIST" };
  }
  if (await prisma.suppressionEntry.findUnique({
    where: { email: conversation.contactEmail.toLowerCase() } }))
    return { ok: false, reason: "this address is on the suppression list" };

  // Thread the reply onto the most recent inbound message so mail clients group it correctly.
  const lastInbound = conversation.messages.find((m) => m.direction === "INBOUND");
  const references = [lastInbound?.references, lastInbound?.rfcMessageId]
    .filter(Boolean).join(" ") || undefined;
  const subject = conversation.subject?.toLowerCase().startsWith("re:")
    ? conversation.subject
    : `Re: ${conversation.subject ?? ""}`.trim();

  try {
    const provider = providerFor(mailbox);
    const res = await provider.sendReply({
      from: mailbox.emailAddress, fromName: mailbox.displayName ?? undefined,
      to: conversation.contactEmail, subject,
      bodyText: body, bodyHtml: body.replace(/\n/g, "<br>"),
      threadId: conversation.providerThreadId,
      inReplyTo: lastInbound?.rfcMessageId ?? undefined, references,
    });
    await prisma.emailMessage.create({
      data: {
        conversationId: conversation.id, mailboxId: mailbox.id, direction: "OUTBOUND",
        providerMessageId: res.providerMessageId,
        providerThreadId: res.providerThreadId || conversation.providerThreadId,
        rfcMessageId: res.rfcMessageId ?? newRfcMessageId(mailbox.domain ?? "localhost"),
        inReplyTo: lastInbound?.rfcMessageId ?? null, references: references ?? null,
        fromAddress: mailbox.emailAddress, toAddress: conversation.contactEmail,
        subject, bodyText: body, bodyHtml: body.replace(/\n/g, "<br>"), sentAt: new Date(),
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id }, data: { unread: false, lastMessageAt: new Date() } });
    await prisma.auditEvent.create({
      data: { eventType: "REPLY_SENT", pharmacyId: conversation.pharmacyId,
              detail: conversation.contactEmail, ...actorFields(actor) } });
    return { ok: true, providerMessageId: res.providerMessageId };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await prisma.auditEvent.create({
      data: { eventType: "REPLY_FAILED", pharmacyId: conversation.pharmacyId,
              detail: reason.slice(0, 200), ...actorFields(actor) } });
    return { ok: false, reason };
  }
}

/** Operator classification. This always wins over anything inbox sync inferred. */
export async function setLeadStatus(
  pharmacyId: number, status: LeadStatus, note?: string, actor?: Actor) {
  const before = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId }, select: { leadStatus: true, email: true } });
  if (!before) throw new Error("pharmacy not found");
  await prisma.pharmacy.update({ where: { id: pharmacyId }, data: { leadStatus: status } });
  await prisma.auditEvent.create({
    data: { eventType: "LEAD_STATUS_CHANGED", pharmacyId,
            detail: `${before.leadStatus} -> ${status}${note ? `: ${note}` : ""}`,
            ...actorFields(actor) } });
  // An operator marking a lead unsubscribed must suppress the address, not just relabel it.
  if (status === "UNSUBSCRIBED" && before.email)
    await suppress(before.email, "UNSUBSCRIBED", actor?.email ?? "admin",
      note ?? "marked in the CRM");
}

export async function markRead(conversationId: number, unread = false) {
  if (isCrmShowcase()) return;
  await prisma.conversation.update({ where: { id: conversationId }, data: { unread } });
}

export async function scheduleFollowUp(
  pharmacyId: number, dueAt: Date, note?: string, conversationId?: number, actor?: Actor) {
  const fu = await prisma.followUp.create({
    data: { pharmacyId, dueAt, note: note ?? null, conversationId: conversationId ?? null } });
  await prisma.auditEvent.create({
    data: { eventType: "FOLLOW_UP_SCHEDULED", pharmacyId,
            detail: `due ${dueAt.toISOString().slice(0, 10)}`, ...actorFields(actor) } });
  return fu;
}

export async function closeFollowUp(
  id: number, status: "COMPLETED" | "CANCELLED", actor?: Actor) {
  const fu = await prisma.followUp.update({
    where: { id }, data: { status, completedAt: new Date() } });
  await prisma.auditEvent.create({
    data: { eventType: `FOLLOW_UP_${status}`, pharmacyId: fu.pharmacyId,
            ...actorFields(actor) } });
  return fu;
}

/** PENDING rows whose due date has arrived are reported as DUE - the status column is not a clock. */
export async function followUpBoard(at: Date = new Date()) {
  const rows = await prisma.followUp.findMany({
    where: { status: { in: ["PENDING", "DUE"] } },
    orderBy: { dueAt: "asc" },
    include: { pharmacy: { select: { id: true, canonicalName: true, email: true, city: true, state: true,
                                     leadStatus: true } } },
  });
  return rows.map((f) => ({ ...f, due: f.dueAt <= at }));
}
