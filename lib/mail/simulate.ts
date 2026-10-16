/**
 * Demo-mode simulation. Lets an operator see what a reply, a bounce, an unsubscribe or a send
 * failure does to the CRM without any real mail existing.
 *
 * Every function here refuses outright when EMAIL_MODE=gmail. Simulated events must never be
 * mixed into a real mailbox's history, and fabricated traffic must never be able to reach data
 * that came from an actual provider.
 */
import { prisma } from "../db";
import { config } from "../config";
import { ingestInbound } from "./sync";
import { suppress } from "../campaign/suppression";

export type SimulationKind = "REPLY" | "BOUNCE" | "UNSUBSCRIBE" | "FAILURE";
export type SimulationResult = { ok: true; detail: string } | { ok: false; reason: string };

const GUARD = "simulation is only available in demo email mode (EMAIL_MODE=mock)";

export async function simulate(
  recipientId: number, kind: SimulationKind, body?: string,
): Promise<SimulationResult> {
  if (config.emailMode === "gmail") return { ok: false, reason: GUARD };

  const recipient = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } });
  if (!recipient) return { ok: false, reason: "recipient not found" };
  if (!recipient.mailboxId) return { ok: false, reason: "this recipient has no mailbox yet" };
  // A reply or a bounce can only follow a message the provider accepted; a send failure only
  // makes sense against one that is currently recorded as sent.
  const ACCEPTED = ["SENT", "REPLIED", "BOUNCED"];
  if ((kind === "REPLY" || kind === "BOUNCE") && !ACCEPTED.includes(recipient.status))
    return { ok: false, reason: `recipient is ${recipient.status}; nothing was sent to them` };
  if (kind === "FAILURE" && recipient.status !== "SENT")
    return { ok: false, reason: `recipient is ${recipient.status}, not SENT` };

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const threadId = recipient.providerThreadId ?? `mock-thread-${stamp}`;
  const mailbox = await prisma.mailbox.findUnique({ where: { id: recipient.mailboxId } });
  if (!mailbox) return { ok: false, reason: "mailbox not found" };

  if (kind === "UNSUBSCRIBE") {
    await suppress(recipient.recipientEmail, "UNSUBSCRIBED", "simulation",
      "simulated from the campaign screen in demo mode");
    return { ok: true, detail: `${recipient.recipientEmail} unsubscribed and suppressed` };
  }

  if (kind === "FAILURE") {
    const reason = "simulated provider failure";
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "FAILED", failedAt: new Date(), errorMessage: reason },
    });
    await prisma.mailbox.update({ where: { id: mailbox.id }, data: { lastError: reason } });
    await prisma.auditEvent.create({
      data: { eventType: "EMAIL_FAILED", actor: "simulation", pharmacyId: recipient.pharmacyId,
              detail: reason } });
    return { ok: true, detail: `${recipient.recipientEmail} marked FAILED` };
  }

  const isBounce = kind === "BOUNCE";
  const created = await ingestInbound(mailbox.id, {
    providerMessageId: `mock-sim-${stamp}`,
    providerThreadId: threadId,
    rfcMessageId: `<sim-${stamp}@simulation.local>`,
    from: isBounce ? "mailer-daemon@simulation.local" : recipient.recipientEmail,
    to: mailbox.emailAddress,
    subject: isBounce ? "Delivery Status Notification (Failure)" : "Re: your message",
    bodyText: isBounce
      ? "550 5.1.1 The email account that you tried to reach does not exist. (simulated)"
      : body?.trim() || "Thanks for getting in touch - please send pricing. (simulated)",
    receivedAt: new Date(),
    isBounce,
  });
  if (!created)
    return { ok: false, reason: "the message could not be matched back to this campaign" };
  return { ok: true, detail: isBounce
    ? `${recipient.recipientEmail} bounced and was suppressed`
    : `reply recorded from ${recipient.recipientEmail}` };
}
