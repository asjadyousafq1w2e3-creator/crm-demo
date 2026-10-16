import type { Mailbox } from "@prisma/client";
import { config } from "../config";
import { localDate, windowStatus } from "./schedule";

/**
 * Chooses which mailbox sends the next message.
 *
 * Three rules, in order:
 *
 *   1. The campaign's sending pool. If a campaign names its mailboxes, only those are candidates.
 *      An empty pool means "any eligible mailbox", so an existing campaign behaves as before.
 *   2. The pharmacy's assigned mailbox. Once someone has been contacted from an address, every
 *      later message to them goes from that same address while it is usable. A recipient who
 *      hears from two different senders about the same thing reads it as a mailing list.
 *   3. Most headroom first. Explicitly NOT round-robin: a mailbox with no quota left must be
 *      skipped, not handed a message that then fails.
 */
export type RouterCandidate = { mailbox: Mailbox; remaining: number };
export type BlockedMailbox = { email: string; reason: string };

export type RouteResult =
  | { ok: true; mailbox: Mailbox; remaining: number; reason: RouteReason }
  | { ok: false; reason: string; blocked: BlockedMailbox[] };

/** Why this mailbox, in words the review screen can show verbatim. */
export type RouteReason =
  | "assigned to this pharmacy"
  | "assigned mailbox unavailable, rerouted"
  | "most capacity remaining";

export type RouteOptions = {
  /** The pharmacy's existing mailbox, if it has one. */
  assignedMailboxId?: number | null;
  /** Campaigns can opt out of stickiness; on by default. */
  useAssigned?: boolean;
};

/** Effective cap: MANUAL honours the mailbox's own limit, other stages cap by ramp policy. */
export function effectiveDailyLimit(m: Mailbox): number {
  const ramp = config.rampLimits[m.rampStage];
  if (m.rampStage === "MANUAL" || !ramp) return m.dailyLimit;
  return Math.min(m.dailyLimit, ramp);
}

export function remainingToday(m: Mailbox, at: Date = new Date()): number {
  const today = localDate(m.timezone, at);
  const sent = m.sentDate === today ? m.sentToday : 0;   // counter resets at local midnight
  return Math.max(0, effectiveDailyLimit(m) - sent);
}

/** Volume already sent today across every mailbox, each counted in its own local day. */
export function sentTodayAcross(mailboxes: Mailbox[], at: Date = new Date()): number {
  return mailboxes.reduce(
    (sum, m) => sum + (m.sentDate === localDate(m.timezone, at) ? m.sentToday : 0), 0);
}

/**
 * The account-wide ceiling. Separate from per-mailbox limits on purpose: adding a mailbox should
 * not silently raise total volume without someone deciding to raise it.
 */
export function globalHeadroom(mailboxes: Mailbox[], at: Date = new Date()): number {
  return Math.max(0, config.limits.globalDaily - sentTodayAcross(mailboxes, at));
}

/** Why a single mailbox cannot be used right now, or null if it can. */
export function unusableReason(m: Mailbox, at: Date = new Date()): string | null {
  if (m.status === "PAUSED") return "paused";
  if (m.status !== "CONNECTED") return `status ${m.status.toLowerCase()}`;
  if (m.healthStatus === "UNHEALTHY") return "health unhealthy";
  if (m.provider === "gmail" && !m.encryptedRefreshToken) return "needs reconnecting";
  const w = windowStatus({
    timezone: m.timezone, sendingDays: "1,2,3,4,5,6,7",
    sendingStartTime: m.sendingStartTime, sendingEndTime: m.sendingEndTime,
  }, at);
  if (!w.open) return `outside window (${w.reason.toLowerCase().replace(/_/g, " ")})`;
  if (remainingToday(m, at) <= 0) return "daily limit reached";
  return null;
}

export function route(
  mailboxes: Mailbox[], at: Date = new Date(), options: RouteOptions = {},
): RouteResult {
  const blocked: BlockedMailbox[] = [];
  const usable: RouterCandidate[] = [];

  for (const m of mailboxes) {
    const reason = unusableReason(m, at);
    if (reason) blocked.push({ email: m.emailAddress, reason });
    else usable.push({ mailbox: m, remaining: remainingToday(m, at) });
  }
  if (!usable.length) return { ok: false, reason: "no mailbox available", blocked };

  // 2. Keep the existing sender if the campaign allows it and that mailbox is usable.
  const useAssigned = options.useAssigned ?? true;
  if (useAssigned && options.assignedMailboxId) {
    const sticky = usable.find((c) => c.mailbox.id === options.assignedMailboxId);
    if (sticky)
      return { ok: true, mailbox: sticky.mailbox, remaining: sticky.remaining,
               reason: "assigned to this pharmacy" };
  }

  // 3. Otherwise the mailbox with the most headroom.
  usable.sort((a, b) => b.remaining - a.remaining || a.mailbox.id - b.mailbox.id);
  const pick = usable[0];
  const rerouted = Boolean(useAssigned && options.assignedMailboxId);
  return {
    ok: true, mailbox: pick.mailbox, remaining: pick.remaining,
    reason: rerouted ? "assigned mailbox unavailable, rerouted" : "most capacity remaining",
  };
}

/**
 * How much could still go out today. Quota, not availability: a mailbox outside its sending
 * window still has capacity today, it just is not usable this minute.
 */
export function totalCapacityToday(mailboxes: Mailbox[], at: Date = new Date()): number {
  const perMailbox = mailboxes
    .filter((m) => m.status === "CONNECTED" && m.healthStatus !== "UNHEALTHY")
    .reduce((sum, m) => sum + remainingToday(m, at), 0);
  // The account ceiling caps the total however much per-mailbox quota exists.
  return Math.min(perMailbox, globalHeadroom(mailboxes, at));
}
