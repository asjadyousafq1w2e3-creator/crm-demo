/**
 * Working the inbox: filtering, bulk triage, ownership and snoozing.
 *
 * A unified inbox is standard in every outreach tool now, and on its own it is just a list. What
 * makes one usable is being able to answer "what needs me, today" in one click and clear the
 * rest in bulk - out-of-office replies and autoresponders are most of the volume and none of the
 * value, and reading them one at a time is how an inbox stops getting read at all.
 */
import { prisma } from "../db";
import { isCrmShowcase } from "../showcase-mode";
import type { Prisma } from "@prisma/client";
import { CATEGORIES, type Category } from "./classify";

export type View = "NEEDS_ME" | "UNREAD" | "MINE" | "UNASSIGNED" | "SNOOZED" | "CLOSED" | "ALL";

export const VIEWS: { key: View; label: string; hint: string }[] = [
  { key: "NEEDS_ME", label: "Needs attention",
    hint: "Open replies from a person - the ones worth reading today" },
  { key: "UNREAD", label: "Unread", hint: "Anything nobody has opened yet" },
  { key: "MINE", label: "Assigned to me", hint: "Yours to answer" },
  { key: "UNASSIGNED", label: "Unassigned", hint: "Open and nobody has picked it up" },
  { key: "SNOOZED", label: "Snoozed", hint: "Coming back later" },
  { key: "CLOSED", label: "Closed", hint: "Dealt with" },
  { key: "ALL", label: "Everything", hint: "No filter at all" },
];

/** Categories where a person actually wrote to us. The default view is exactly these. */
const HUMAN: Category[] =
  ["UNCATEGORISED", "INTERESTED", "QUESTION", "NOT_INTERESTED", "WRONG_PERSON",
   "UNSUBSCRIBE_REQUEST"];

export type InboxFilter = {
  view?: View;
  category?: Category;
  campaignId?: number;
  mailboxId?: number;
  assignedToId?: number;
  search?: string;
  meId?: number;
};

export function inboxWhere(f: InboxFilter): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {};
  const and: Prisma.ConversationWhereInput[] = [];

  switch (f.view ?? "NEEDS_ME") {
    case "NEEDS_ME":
      and.push({ state: "OPEN" }, { category: { in: HUMAN } });
      break;
    case "UNREAD":   and.push({ unread: true }); break;
    case "MINE":     and.push({ state: "OPEN" }, { assignedToId: f.meId ?? -1 }); break;
    case "UNASSIGNED": and.push({ state: "OPEN" }, { assignedToId: null }); break;
    case "SNOOZED":  and.push({ state: "SNOOZED" }); break;
    case "CLOSED":   and.push({ state: "CLOSED" }); break;
    case "ALL":      break;
  }

  if (f.category) and.push({ category: f.category });
  if (f.campaignId) and.push({ campaignId: f.campaignId });
  if (f.mailboxId) and.push({ mailboxId: f.mailboxId });
  if (f.assignedToId) and.push({ assignedToId: f.assignedToId });

  if (f.search?.trim()) {
    const q = f.search.trim();
    and.push({ OR: [
      { subject: { contains: q, mode: "insensitive" } },
      { contactEmail: { contains: q, mode: "insensitive" } },
      { pharmacy: { canonicalName: { contains: q, mode: "insensitive" } } },
      { pharmacy: { city: { contains: q, mode: "insensitive" } } },
      { messages: { some: { bodyText: { contains: q, mode: "insensitive" } } } },
    ] });
  }

  if (and.length) where.AND = and;
  return where;
}

/** Counts for the view tabs, so the numbers on the tabs are real rather than decorative. */
export async function viewCounts(meId?: number) {
  const [needsMe, unread, mine, unassigned, snoozed, closed, all] = await Promise.all(
    (["NEEDS_ME", "UNREAD", "MINE", "UNASSIGNED", "SNOOZED", "CLOSED", "ALL"] as View[])
      .map((view) => prisma.conversation.count({ where: inboxWhere({ view, meId }) })));
  return { NEEDS_ME: needsMe, UNREAD: unread, MINE: mine, UNASSIGNED: unassigned,
           SNOOZED: snoozed, CLOSED: closed, ALL: all } as Record<View, number>;
}

/** How the replies break down. Feeds the filter chips and the campaign reply mix. */
export async function categoryCounts(f: InboxFilter = {}) {
  const rows = await prisma.conversation.groupBy({
    by: ["category"], _count: true,
    where: inboxWhere({ ...f, category: undefined }),
  });
  return Object.fromEntries(
    CATEGORIES.map((c) => [c, rows.find((r) => r.category === c)?._count ?? 0]),
  ) as Record<Category, number>;
}

export async function listConversations(f: InboxFilter, page = 1, perPage = 25) {
  const where = inboxWhere(f);
  const [rows, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: [{ unread: "desc" }, { lastMessageAt: "desc" }],
      skip: (page - 1) * perPage, take: perPage,
      include: {
        pharmacy: { select: { id: true, canonicalName: true, city: true, state: true,
                              leadStatus: true } },
        mailbox: { select: { id: true, emailAddress: true } },
        campaign: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
          orderBy: { createdAt: "desc" }, take: 1,
          select: { direction: true, bodyText: true, receivedAt: true, sentAt: true },
        },
      },
    }),
    prisma.conversation.count({ where }),
  ]);
  return { rows, total, pages: Math.max(1, Math.ceil(total / perPage)) };
}

/** Options for the filter selects, drawn from what is actually in the inbox. */
export async function inboxOptions() {
  const [campaigns, mailboxes, operators] = await Promise.all([
    prisma.campaign.findMany({
      where: { conversations: { some: {} } },
      select: { id: true, name: true }, orderBy: { id: "desc" },
    }),
    prisma.mailbox.findMany({ select: { id: true, emailAddress: true } }),
    prisma.appUser.findMany({
      where: { status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MANAGER", "AGENT"] } },
      select: { id: true, name: true, email: true }, orderBy: { name: "asc" },
    }),
  ]);
  return { campaigns, mailboxes, operators };
}

// --------------------------------------------------------------------------- acting on threads

/**
 * An operator's category always outranks the classifier's, and is recorded as theirs so the
 * next sync does not quietly change it back.
 */
export async function setCategory(id: number, category: Category, actor: string) {
  await prisma.conversation.update({
    where: { id },
    data: { category, categorySource: "OPERATOR", categoryReason: `set by ${actor}` },
  });
}

export async function assignConversation(id: number, assignedToId: number | null) {
  await prisma.conversation.update({ where: { id }, data: { assignedToId } });
}

export async function snoozeConversation(id: number, days: number) {
  const until = new Date();
  until.setHours(0, 0, 0, 0);
  await prisma.conversation.update({
    where: { id },
    data: { state: "SNOOZED", snoozedUntil: new Date(until.getTime() + days * 86_400_000),
            unread: false },
  });
}

export async function closeConversation(id: number) {
  await prisma.conversation.update({
    where: { id },
    data: { state: "CLOSED", closedAt: new Date(), unread: false, snoozedUntil: null },
  });
}

export async function reopenConversation(id: number) {
  await prisma.conversation.update({
    where: { id },
    data: { state: "OPEN", closedAt: null, snoozedUntil: null },
  });
}

export const BULK_ACTIONS = ["CLOSE", "REOPEN", "MARK_READ", "MARK_UNREAD",
                             "ASSIGN", "SNOOZE", "CATEGORISE"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/**
 * Apply one action to a selection.
 *
 * Bulk triage is the point of the inbox view: clearing forty out-of-office replies should be one
 * action, not forty. Each branch is a single updateMany rather than a loop, so a large selection
 * is one statement and either all of it happens or none of it does.
 */
export async function runBulk(
  action: BulkAction, ids: number[], options: {
    assignedToId?: number | null; days?: number; category?: Category; actor: string },
): Promise<{ changed: number; message: string }> {
  if (!ids.length) return { changed: 0, message: "Nothing was selected." };
  const where = { id: { in: ids } };

  switch (action) {
    case "CLOSE": {
      const { count } = await prisma.conversation.updateMany({
        where, data: { state: "CLOSED", closedAt: new Date(), unread: false } });
      return { changed: count, message: `Closed ${count}.` };
    }
    case "REOPEN": {
      const { count } = await prisma.conversation.updateMany({
        where, data: { state: "OPEN", closedAt: null, snoozedUntil: null } });
      return { changed: count, message: `Reopened ${count}.` };
    }
    case "MARK_READ": {
      const { count } = await prisma.conversation.updateMany({ where, data: { unread: false } });
      return { changed: count, message: `Marked ${count} read.` };
    }
    case "MARK_UNREAD": {
      const { count } = await prisma.conversation.updateMany({ where, data: { unread: true } });
      return { changed: count, message: `Marked ${count} unread.` };
    }
    case "ASSIGN": {
      const { count } = await prisma.conversation.updateMany({
        where, data: { assignedToId: options.assignedToId ?? null } });
      return { changed: count,
               message: options.assignedToId ? `Assigned ${count}.` : `Unassigned ${count}.` };
    }
    case "SNOOZE": {
      const days = options.days ?? 3;
      const base = new Date(); base.setHours(0, 0, 0, 0);
      const { count } = await prisma.conversation.updateMany({
        where, data: { state: "SNOOZED", unread: false,
                       snoozedUntil: new Date(base.getTime() + days * 86_400_000) } });
      return { changed: count, message: `Snoozed ${count} for ${days} days.` };
    }
    case "CATEGORISE": {
      if (!options.category) return { changed: 0, message: "No category was chosen." };
      const { count } = await prisma.conversation.updateMany({
        where, data: { category: options.category, categorySource: "OPERATOR",
                       categoryReason: `set in bulk by ${options.actor}` } });
      return { changed: count, message: `Recategorised ${count}.` };
    }
  }
}

/**
 * Brings snoozed conversations back when their time is up.
 *
 * Run from the worker tick, and also on every inbox load, so a stopped worker delays nothing -
 * a snooze that silently never returns is worse than no snooze at all.
 */
export async function wakeSnoozed(now: Date = new Date()): Promise<number> {
  if (isCrmShowcase()) return 0;
  const { count } = await prisma.conversation.updateMany({
    where: { state: "SNOOZED", snoozedUntil: { lte: now } },
    data: { state: "OPEN", snoozedUntil: null },
  });
  return count;
}
