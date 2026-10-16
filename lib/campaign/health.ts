/**
 * Mailbox health and the automatic safety brake.
 *
 * Health here is measured from outcomes the system actually observed - messages the provider
 * accepted, bounce notifications that arrived, sends that threw. It is not a reputation score,
 * not a deliverability prediction, and it says nothing about whether a message reached an inbox.
 */
import { prisma } from "../db";
import { config } from "../config";
import { effectiveDailyLimit, remainingToday } from "./router";
import type { Mailbox } from "@prisma/client";

export type MailboxHealth = {
  mailbox: Mailbox;
  sent: number;
  bounced: number;
  failed: number;
  replied: number;
  bounceRate: number | null;      // null until enough sends to be meaningful
  replyRate: number | null;
  consecutiveFailures: number;
  capacity: { limit: number; remaining: number };
  warnings: string[];
  shouldPause: string | null;     // non-null means the safety brake applies
};

/** Leading run of failures on this mailbox's most recent attempts. */
async function consecutiveFailures(mailboxId: number): Promise<number> {
  const recent = await prisma.campaignRecipient.findMany({
    where: { mailboxId, status: { in: ["SENT", "FAILED", "BOUNCED", "REPLIED"] } },
    orderBy: { updatedAt: "desc" }, take: 25, select: { status: true },
  });
  let n = 0;
  for (const r of recent) {
    if (r.status === "FAILED") n++;
    else break;
  }
  return n;
}

export async function mailboxHealth(mailbox: Mailbox, at: Date = new Date()): Promise<MailboxHealth> {
  const counts = await prisma.campaignRecipient.groupBy({
    by: ["status"], where: { mailboxId: mailbox.id }, _count: true });
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  const sent = n("SENT") + n("REPLIED") + n("BOUNCED");   // every message the provider accepted
  const bounced = n("BOUNCED");
  const failed = n("FAILED");
  const replied = n("REPLIED");
  const enough = sent >= config.autoPause.minSendsBeforeBounceCheck;
  const bounceRate = enough ? (bounced / sent) * 100 : null;
  const replyRate = sent > 0 ? (replied / sent) * 100 : null;
  const streak = await consecutiveFailures(mailbox.id);

  const warnings: string[] = [];
  let shouldPause: string | null = null;

  if (bounceRate !== null && bounceRate >= config.autoPause.bounceRateThreshold)
    shouldPause = `bounce rate ${bounceRate.toFixed(1)}% at or above the ` +
      `${config.autoPause.bounceRateThreshold}% threshold over ${sent} sends`;
  else if (bounceRate !== null && bounceRate >= config.autoPause.bounceRateThreshold / 2)
    warnings.push(`bounce rate ${bounceRate.toFixed(1)}% is over half the pause threshold`);

  if (!shouldPause && streak >= config.autoPause.consecutiveFailuresThreshold)
    shouldPause = `${streak} consecutive send failures`;
  else if (streak > 0) warnings.push(`${streak} consecutive send failure(s)`);

  if (!enough && sent > 0)
    warnings.push(`only ${sent} sends so far - bounce rate is not evaluated below ` +
      `${config.autoPause.minSendsBeforeBounceCheck}`);
  if (mailbox.lastError) warnings.push(`last error: ${mailbox.lastError.slice(0, 120)}`);
  if (mailbox.provider === "gmail" && !mailbox.encryptedRefreshToken)
    warnings.push("no stored refresh token - the mailbox needs reconnecting before it can send");

  return {
    mailbox, sent, bounced, failed, replied, bounceRate, replyRate,
    consecutiveFailures: streak,
    capacity: { limit: effectiveDailyLimit(mailbox), remaining: remainingToday(mailbox, at) },
    warnings, shouldPause,
  };
}

export async function allMailboxHealth(at: Date = new Date()): Promise<MailboxHealth[]> {
  const mailboxes = await prisma.mailbox.findMany({ orderBy: { id: "asc" } });
  return Promise.all(mailboxes.map((m) => mailboxHealth(m, at)));
}

/**
 * The safety brake. Pauses a mailbox that crosses a threshold and records why.
 * Pausing is deliberately one-way: a human has to look at the reason and resume it.
 */
export async function enforceSafetyBrakes(at: Date = new Date()): Promise<string[]> {
  const paused: string[] = [];
  for (const h of await allMailboxHealth(at)) {
    if (!h.shouldPause) continue;
    if (h.mailbox.status === "PAUSED" || h.mailbox.status === "DISCONNECTED") continue;
    await prisma.mailbox.update({
      where: { id: h.mailbox.id },
      data: { status: "PAUSED", healthStatus: "UNHEALTHY", lastError: h.shouldPause },
    });
    await prisma.auditEvent.create({
      data: { eventType: "MAILBOX_AUTO_PAUSED", actor: "worker",
        detail: `${h.mailbox.emailAddress}: ${h.shouldPause}` },
    });
    paused.push(`${h.mailbox.emailAddress}: ${h.shouldPause}`);
  }
  return paused;
}
