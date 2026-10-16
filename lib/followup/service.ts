/**
 * The follow-up queue: what somebody actually has to do today.
 *
 * A sales rep opens one screen each morning that says who to contact, in what order, and gets
 * out of the way. That is the whole design brief. The buckets below are ordered by when
 * something was due, not by when it was created, because an overdue task is the only kind that
 * gets worse by waiting.
 *
 * Snoozing is counted rather than hidden. A task pushed back five times is not a task anybody
 * intends to do, and a queue that quietly keeps re-offering it is how a pipeline fills with
 * work nobody will ever finish.
 */
import { prisma } from "../db";
import { isCrmShowcase } from "../showcase-mode";
import type { Prisma } from "@prisma/client";

export const KINDS = ["EMAIL", "CALL", "CHECK"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  EMAIL: "Send an email", CALL: "Make a call", CHECK: "Check something",
};

export const PRIORITIES = ["NORMAL", "HIGH"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Pushed back this many times without being done, a task is worth questioning rather than re-offering. */
export const STALE_SNOOZES = 3;

export type Bucket = "OVERDUE" | "TODAY" | "TOMORROW" | "LATER";

export type QueueFilter = {
  assignedToId?: number | "unassigned" | "anyone";
  kind?: Kind;
  priority?: Priority;
  state?: string;
  search?: string;
};

/** Start of the day, in the server's zone. Tasks are day-granular; minutes would be false precision. */
function startOfDay(at: Date): Date {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function bucketFor(dueAt: Date, now: Date = new Date()): Bucket {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const dayAfter = new Date(today.getTime() + 2 * 86_400_000);
  if (dueAt < today) return "OVERDUE";
  if (dueAt < tomorrow) return "TODAY";
  if (dueAt < dayAfter) return "TOMORROW";
  return "LATER";
}

export function queueWhere(f: QueueFilter): Prisma.FollowUpWhereInput {
  const where: Prisma.FollowUpWhereInput = {
    status: { in: f.state ? [f.state] : ["PENDING", "DUE"] },
  };
  if (f.assignedToId === "unassigned") where.assignedToId = null;
  else if (typeof f.assignedToId === "number") where.assignedToId = f.assignedToId;
  if (f.kind) where.kind = f.kind;
  if (f.priority) where.priority = f.priority;
  if (f.search?.trim()) {
    const q = f.search.trim();
    where.OR = [
      { note: { contains: q, mode: "insensitive" } },
      { pharmacy: { canonicalName: { contains: q, mode: "insensitive" } } },
      { pharmacy: { city: { contains: q, mode: "insensitive" } } },
      { pharmacy: { email: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

const WITH_CONTEXT = {
  pharmacy: {
    select: { id: true, canonicalName: true, city: true, state: true, phone: true,
              email: true, leadStatus: true },
  },
  assignedTo: { select: { id: true, name: true, email: true } },
} satisfies Prisma.FollowUpInclude;

/**
 * The queue, grouped the way it gets worked.
 *
 * Overdue and today come back in full because they are the day's work. Later is capped: a list
 * of everything scheduled for the next three months is a planning document, not a to-do list,
 * and rendering it teaches people to scroll past the part that matters.
 */
export async function queue(f: QueueFilter = {}, now: Date = new Date()) {
  const where = queueWhere(f);
  const today = startOfDay(now);
  const dayAfterTomorrow = new Date(today.getTime() + 2 * 86_400_000);

  const [due, later, laterTotal] = await Promise.all([
    prisma.followUp.findMany({
      where: { ...where, dueAt: { lt: dayAfterTomorrow } },
      include: WITH_CONTEXT, orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
    }),
    prisma.followUp.findMany({
      where: { ...where, dueAt: { gte: dayAfterTomorrow } },
      include: WITH_CONTEXT, orderBy: { dueAt: "asc" }, take: 25,
    }),
    prisma.followUp.count({ where: { ...where, dueAt: { gte: dayAfterTomorrow } } }),
  ]);

  const group = (b: Bucket) => due.filter((t) => bucketFor(t.dueAt, now) === b);

  return {
    overdue: group("OVERDUE"),
    today: group("TODAY"),
    tomorrow: group("TOMORROW"),
    later,
    laterTotal,
    /** Everything the queue considers actionable now - the number that belongs in a badge. */
    actionable: group("OVERDUE").length + group("TODAY").length,
  };
}

/** Headline counts, computed in SQL rather than by loading the queue and measuring it. */
export async function queueStats(f: QueueFilter = {}, now: Date = new Date()) {
  const where = queueWhere(f);
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);

  const [overdue, dueToday, upcoming, unassigned, highPriority, stale, completedToday] =
    await Promise.all([
      prisma.followUp.count({ where: { ...where, dueAt: { lt: today } } }),
      prisma.followUp.count({ where: { ...where, dueAt: { gte: today, lt: tomorrow } } }),
      prisma.followUp.count({ where: { ...where, dueAt: { gte: tomorrow } } }),
      prisma.followUp.count({ where: { ...queueWhere({ ...f, assignedToId: undefined }),
                                       assignedToId: null } }),
      prisma.followUp.count({ where: { ...where, priority: "HIGH" } }),
      prisma.followUp.count({ where: { ...where, snoozeCount: { gte: STALE_SNOOZES } } }),
      prisma.followUp.count({
        where: { status: "COMPLETED", completedAt: { gte: today, lt: tomorrow } } }),
    ]);

  return { overdue, dueToday, upcoming, unassigned, highPriority, stale, completedToday };
}

/** Who tasks can be handed to. Viewers cannot act on one, so they are not offered. */
export async function assignableOperators() {
  return prisma.appUser.findMany({
    where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MANAGER", "AGENT"] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

export type CreateInput = {
  pharmacyId: number;
  conversationId?: number | null;
  dueAt: Date;
  kind?: Kind;
  priority?: Priority;
  note?: string;
  assignedToId?: number | null;
  createdBy: string;
};

export async function createTask(input: CreateInput) {
  return prisma.followUp.create({
    data: {
      pharmacyId: input.pharmacyId,
      conversationId: input.conversationId ?? null,
      dueAt: input.dueAt,
      kind: input.kind ?? "EMAIL",
      priority: input.priority ?? "NORMAL",
      note: input.note?.trim() || null,
      assignedToId: input.assignedToId ?? null,
      createdBy: input.createdBy,
    },
  });
}

/**
 * Push a task back, and record that it happened.
 *
 * The new due date is computed from today rather than from the original due date. Adding three
 * days to a task that was due last week would schedule it in the past and it would reappear
 * immediately as overdue, which reads as a bug and is really an arithmetic choice.
 */
export async function snooze(id: number, days: number, now: Date = new Date()) {
  const base = startOfDay(now);
  return prisma.followUp.update({
    where: { id },
    data: {
      dueAt: new Date(base.getTime() + days * 86_400_000),
      status: "PENDING",
      snoozeCount: { increment: 1 },
    },
  });
}

export async function complete(id: number, outcome?: string) {
  return prisma.followUp.update({
    where: { id },
    data: { status: "COMPLETED", completedAt: new Date(), outcome: outcome?.trim() || null },
  });
}

export async function cancel(id: number, reason?: string) {
  return prisma.followUp.update({
    where: { id },
    data: { status: "CANCELLED", completedAt: new Date(), outcome: reason?.trim() || null },
  });
}

export async function assign(id: number, assignedToId: number | null) {
  return prisma.followUp.update({ where: { id }, data: { assignedToId } });
}

/**
 * Marks tasks whose time has come as DUE.
 *
 * PENDING and DUE are treated identically by every query here, so this is cosmetic rather than
 * load-bearing - which is deliberate. A queue that only works if a background job ran is a queue
 * that silently empties when the worker stops.
 */
export async function promoteDue(now: Date = new Date()): Promise<number> {
  if (isCrmShowcase()) return 0;
  const { count } = await prisma.followUp.updateMany({
    where: { status: "PENDING", dueAt: { lte: now } },
    data: { status: "DUE" },
  });
  return count;
}
