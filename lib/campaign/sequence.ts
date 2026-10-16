/**
 * Multi-step sequences: the first email, then the follow-ups that only go if nobody answered.
 *
 * This is the difference between a mail merge and an outreach system. Most replies to cold
 * outreach come from the second or third message rather than the first, so a tool that sends
 * once is leaving most of the result on the table - and a tool that sends again to somebody who
 * already answered is worse than one that never followed up at all.
 *
 * Two rules hold the whole thing together:
 *
 *   - A step is scheduled from when the PREVIOUS step actually left, never from when the
 *     campaign started. A queue that runs slowly would otherwise compress every gap and fire
 *     three messages in a morning.
 *   - Nothing advances past a recipient who replied, bounced, unsubscribed or was suppressed.
 *     That is checked again at send time, not only here, because a reply can land in the gap
 *     between scheduling and sending.
 */
import { prisma } from "../db";
import type { Prisma } from "@prisma/client";

/** A sequence cannot outrun a person's patience or a mailbox's reputation. */
export const MIN_WAIT_DAYS = 1;
export const MAX_WAIT_DAYS = 60;
export const MAX_STEPS = 6;

export type StepInput = {
  stepNumber: number;
  waitDays: number;
  subject?: string | null;
  bodyHtml: string;
  bodyText: string;
  active?: boolean;
};

export type StepProblem = { step: number; message: string };

/**
 * Checks a whole sequence at once rather than one field at a time, so the editor can show every
 * problem together instead of surfacing them one save at a time.
 */
export function validateSteps(steps: StepInput[]): StepProblem[] {
  const problems: StepProblem[] = [];
  if (steps.length > MAX_STEPS)
    problems.push({ step: 0, message: `A sequence may have at most ${MAX_STEPS} steps.` });

  const numbers = new Set<number>();
  for (const s of steps) {
    if (numbers.has(s.stepNumber))
      problems.push({ step: s.stepNumber, message: "Duplicate step number." });
    numbers.add(s.stepNumber);

    if (!s.bodyText.trim())
      problems.push({ step: s.stepNumber, message: "The message body is empty." });

    // Step 1 is the campaign's own message and goes when the campaign starts.
    if (s.stepNumber === 1) continue;

    if (s.waitDays < MIN_WAIT_DAYS)
      problems.push({ step: s.stepNumber,
        message: `Wait at least ${MIN_WAIT_DAYS} day. A same-day second email reads as a machine.` });
    if (s.waitDays > MAX_WAIT_DAYS)
      problems.push({ step: s.stepNumber, message: `Wait at most ${MAX_WAIT_DAYS} days.` });
  }
  return problems;
}

/** Statuses a recipient can be in and still receive another step. */
const ADVANCEABLE = ["SENT"] as const;

/**
 * Reasons a sequence stops. Recorded on the recipient so the campaign can say why somebody
 * received two messages and somebody else received four.
 */
export const STOP_REASONS = {
  REPLIED: "they replied",
  BOUNCED: "the address bounced",
  UNSUBSCRIBED: "they unsubscribed",
  SUPPRESSED: "the address is suppressed",
  COMPLETED: "the sequence finished",
  MANUAL: "stopped by an operator",
} as const;
export type StopReason = keyof typeof STOP_REASONS;

/**
 * After a step is sent, decide when - or whether - the next one is due.
 *
 * Called by the sender immediately after a successful send, inside the same flow that recorded
 * it, so a recipient cannot end up sent-but-unscheduled.
 */
export async function scheduleNextStep(recipientId: number, sentAt: Date = new Date()) {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: { id: true, campaignId: true, stepNumber: true, status: true },
  });
  if (!recipient) return;

  if (!ADVANCEABLE.includes(recipient.status as "SENT")) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId }, data: { nextStepAt: null } });
    return;
  }

  const next = await prisma.campaignStep.findFirst({
    where: { campaignId: recipient.campaignId, active: true,
             stepNumber: { gt: recipient.stepNumber } },
    orderBy: { stepNumber: "asc" },
  });

  if (!next) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { nextStepAt: null, stoppedReason: "COMPLETED" } });
    return;
  }

  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { nextStepAt: new Date(sentAt.getTime() + next.waitDays * 86_400_000) },
  });
}

/**
 * Recipients whose next step is due now.
 *
 * The worker claims these the same way it claims a first send. Suppression is re-checked at
 * send time by the sender itself - this only finds candidates.
 */
export function dueForNextStep(now: Date = new Date()): Prisma.CampaignRecipientWhereInput {
  return {
    status: "SENT",
    nextStepAt: { not: null, lte: now },
    stoppedReason: null,
    campaign: { status: "RUNNING" },
  };
}

/** Stop a recipient's sequence and say why. Safe to call twice. */
export async function stopSequence(recipientId: number, reason: StopReason) {
  await prisma.campaignRecipient.update({
    where: { id: recipientId },
    data: { nextStepAt: null, stoppedReason: reason },
  });
}

/**
 * What a campaign's sequence is doing, per step.
 *
 * Counted from the step records rather than from the recipient's current position, because the
 * question "how many people got message 3" is about what was sent, not about where anybody
 * happens to be standing now.
 */
export async function sequenceProgress(campaignId: number) {
  const [steps, sentByStep, recipients] = await Promise.all([
    prisma.campaignStep.findMany({
      where: { campaignId }, orderBy: { stepNumber: "asc" } }),
    prisma.campaignRecipientStep.groupBy({
      by: ["stepNumber"], _count: true,
      where: { status: "SENT", recipient: { campaignId } },
    }),
    prisma.campaignRecipient.groupBy({
      by: ["stoppedReason"], _count: true, where: { campaignId } }),
  ]);

  const sentAt = (n: number) => sentByStep.find((r) => r.stepNumber === n)?._count ?? 0;
  const stopped = Object.fromEntries(
    recipients.map((r) => [r.stoppedReason ?? "RUNNING", r._count]));

  return {
    steps: steps.map((s) => ({
      stepNumber: s.stepNumber, waitDays: s.waitDays, active: s.active,
      subject: s.subject, sent: sentAt(s.stepNumber),
    })),
    stopped,
  };
}

/**
 * A plain-English preview of when each step would land, from a given start.
 *
 * Shown in the editor because "wait 3 days, wait 4 days, wait 7 days" is much harder to judge
 * than "day 0, day 3, day 7, day 14" - and judging the spacing is the entire point of writing
 * a sequence rather than one email.
 */
export function schedulePreview(steps: StepInput[]): { step: number; day: number }[] {
  let day = 0;
  const out: { step: number; day: number }[] = [];
  for (const s of [...steps].sort((a, b) => a.stepNumber - b.stepNumber)) {
    if (s.active === false) continue;
    if (s.stepNumber > 1) day += s.waitDays;
    out.push({ step: s.stepNumber, day });
  }
  return out;
}

/**
 * Move recipients whose wait has elapsed back into the send queue.
 *
 * A recipient sits at SENT with a nextStepAt until their wait is up; this advances the step
 * counter and returns them to QUEUED so the ordinary claim-and-send path picks them up. Doing it
 * that way means a follow-up goes through exactly the same eligibility gate, mailbox routing,
 * daily limit and sending window as a first message - there is no second, weaker path through
 * which a follow-up could escape a suppression added yesterday.
 *
 * Recipients whose sequence has already stopped are skipped by the filter, and the gate runs
 * again at send time, because a reply can arrive between this call and the send.
 */
export async function promoteDueSteps(now: Date = new Date()): Promise<number> {
  const due = await prisma.campaignRecipient.findMany({
    where: dueForNextStep(now), select: { id: true, stepNumber: true }, take: 500,
  });
  if (!due.length) return 0;

  let moved = 0;
  for (const r of due) {
    // Guarded by status so a recipient who replied in the meantime is left alone.
    const { count } = await prisma.campaignRecipient.updateMany({
      where: { id: r.id, status: "SENT", stoppedReason: null },
      data: { stepNumber: r.stepNumber + 1, status: "QUEUED", nextStepAt: null,
              queuedAt: now, scheduledAt: null },
    });
    moved += count;
  }
  return moved;
}
