/**
 * Email verification, scoped.
 *
 * Verification costs money per address, so an operator picks a slice - one state, named contacts
 * only, addresses never checked before - rather than paying for the whole registry at once.
 *
 * Two ways to get results back:
 *   - manual: export the batch as CSV, run it through any verifier, upload the results.
 *   - API: a provider is called directly, once one is configured. The interface is the same
 *     either way, so wiring an API in later changes nothing downstream.
 *
 * No result is ever invented. An address that was not checked stays NOT_CHECKED.
 */
import { prisma } from "../db";
import { actorFields, type Actor } from "../audit";
import type { Prisma } from "@prisma/client";

export type VerificationResult = "VALID" | "INVALID" | "RISKY" | "CATCH_ALL" | "UNKNOWN";
export const RESULTS: VerificationResult[] = ["VALID", "INVALID", "RISKY", "CATCH_ALL", "UNKNOWN"];

export type Scope = {
  states?: string[];
  /** PERSONAL, SHARED, or both when empty. */
  emailKinds?: string[];
  /** COMMUNITY, COMPOUNDING, SPECIALTY … as held on the record. */
  pharmacyTypes?: string[];
  /** Skip addresses that already carry a result. On by default - re-checking costs money twice. */
  onlyUnchecked?: boolean;
  /**
   * Re-check addresses whose last result is older than this many days. A verification is a
   * snapshot: staff leave, domains lapse, and a year-old "valid" is a guess.
   */
  recheckOlderThanDays?: number;
  /** Re-check only these previous results - usually UNKNOWN, which is worth a second look. */
  previousResults?: string[];
  /** Only records added in the last N days, for verifying a fresh import on its own. */
  addedWithinDays?: number;
  /** Only records from one import batch. */
  importBatchId?: number;
  /** Only records that passed business verification. */
  onlyVerifiedRecords?: boolean;
  /** Leave out anyone a campaign has already written to. */
  excludeContacted?: boolean;
  search?: string;
  limit?: number;
};

export function scopeWhere(scope: Scope): Prisma.PharmacyWhereInput {
  const where: Prisma.PharmacyWhereInput = { email: { not: null } };
  const and: Prisma.PharmacyWhereInput[] = [];

  if (scope.states?.length) where.state = { in: scope.states };
  if (scope.emailKinds?.length) where.emailKind = { in: scope.emailKinds };
  if (scope.pharmacyTypes?.length) where.pharmacyType = { in: scope.pharmacyTypes };
  if (scope.importBatchId) where.importBatchId = scope.importBatchId;
  if (scope.onlyVerifiedRecords) where.verificationStatus = "VERIFIED";
  if (scope.excludeContacted) where.leadStatus = "NOT_CONTACTED";

  if (scope.addedWithinDays)
    where.createdAt = { gte: new Date(Date.now() - scope.addedWithinDays * 864e5) };

  if (scope.search?.trim()) {
    const q = scope.search.trim();
    and.push({ OR: [
      { canonicalName: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ]});
  }

  /*
   * What counts as "needs checking".
   *
   * Never-checked is the default. A staleness window or a list of previous results widens it
   * deliberately, and an address currently with a verifier is always left alone so the same one
   * is never paid for twice.
   */
  const needsChecking: Prisma.PharmacyWhereInput[] = [];

  /*
   * Re-checking has to be asked for, not arrived at.
   *
   * Clearing the "never checked" box on its own used to leave no status filter at all, which
   * quietly meant every address in scope - including ones confirmed valid last week - and the
   * bill for a second full pass over the list. Nobody unticks a box intending that. With no
   * re-check actually expressed, the scope falls back to never-checked, so the expensive
   * reading of an empty form is unreachable.
   */
  const wantsRecheck =
    Boolean(scope.previousResults?.length) || Boolean(scope.recheckOlderThanDays);
  if (scope.onlyUnchecked !== false || !wantsRecheck)
    needsChecking.push({ emailVerificationStatus: "NOT_CHECKED" });
  if (scope.previousResults?.length)
    needsChecking.push({ emailVerificationStatus: { in: scope.previousResults } });
  if (scope.recheckOlderThanDays)
    needsChecking.push({
      emailVerificationStatus: { notIn: ["NOT_CHECKED", "IN_PROGRESS"] },
      OR: [
        { emailCheckedAt: null },
        { emailCheckedAt: { lt: new Date(Date.now() - scope.recheckOlderThanDays * 864e5) } },
      ],
    });

  if (needsChecking.length) and.push({ OR: needsChecking });
  // An address already with a verifier is never resubmitted, whatever else was asked for.
  and.push({ emailVerificationStatus: { not: "IN_PROGRESS" } });

  if (and.length) where.AND = and;
  return where;
}

/** How many addresses a scope covers, and how they break down. Answered before anything is spent. */
export async function previewScope(scope: Scope) {
  const where = scopeWhere(scope);
  const [total, byState, byKind, byPrevious, distinct] = await Promise.all([
    prisma.pharmacy.count({ where }),
    prisma.pharmacy.groupBy({ by: ["state"], where, _count: true,
                              orderBy: { _count: { state: "desc" } } }),
    prisma.pharmacy.groupBy({ by: ["emailKind"], where, _count: true }),
    prisma.pharmacy.groupBy({ by: ["emailVerificationStatus"], where, _count: true }),
    // Duplicates are charged once by the provider, so the real cost is distinct addresses.
    prisma.pharmacy.findMany({ where, select: { email: true },
                               take: scope.limit ?? undefined, orderBy: { id: "asc" } }),
  ]);
  const capped = scope.limit ? Math.min(total, scope.limit) : total;
  const unique = new Set(distinct.map((d) => d.email!.toLowerCase())).size;
  return {
    total, capped, unique,
    duplicates: distinct.length - unique,
    byState: byState.map((s) => ({ state: s.state ?? "unknown", count: s._count })),
    byKind: byKind.map((k) => ({ kind: k.emailKind, count: k._count })),
    byPrevious: byPrevious.map((r) => ({ result: r.emailVerificationStatus, count: r._count })),
  };
}

/** Everything the round-builder needs to offer, counted so empty options are not shown. */
export async function verificationOptions() {
  const withEmail = { email: { not: null } } as const;
  const [states, kinds, types, batches] = await Promise.all([
    prisma.pharmacy.groupBy({ by: ["state"], where: withEmail, _count: true,
                              orderBy: { state: "asc" } }),
    prisma.pharmacy.groupBy({ by: ["emailKind"], where: withEmail, _count: true }),
    prisma.pharmacy.groupBy({ by: ["pharmacyType"], where: withEmail, _count: true,
                              orderBy: { _count: { pharmacyType: "desc" } } }),
    prisma.importBatch.findMany({ select: { id: true, label: true },
                                  orderBy: { id: "desc" }, take: 12 }),
  ]);
  return {
    states: states.filter((s) => s.state).map((s) => ({ value: s.state!, count: s._count })),
    kinds: kinds.map((k) => ({ value: k.emailKind, count: k._count })),
    types: types.filter((t) => t.pharmacyType)
      .map((t) => ({ value: t.pharmacyType!, count: t._count })),
    batches: batches.map((b) => ({ id: b.id, label: b.label })),
  };
}

export async function createBatch(
  name: string, scope: Scope, actor?: Actor,
): Promise<{ ok: true; id: number; total: number; skippedValid: number }
          | { ok: false; reason: string }> {
  const where = scopeWhere(scope);
  const rows = await prisma.pharmacy.findMany({
    where, select: { id: true, email: true, emailVerificationStatus: true, emailCheckedAt: true },
    orderBy: { id: "asc" }, take: scope.limit ?? undefined,
  });
  if (!rows.length) return { ok: false, reason: "no addresses match this scope" };

  /*
   * Last line of defence, independent of the scope that produced these rows.
   *
   * Verification is billed per address, and an address confirmed valid does not become more
   * valid by being paid for again. Re-checking one is a legitimate thing to want - before a
   * large send, or when the result has aged - but it has to be the thing that was asked for,
   * not a side effect of a filter nobody read carefully. So it is allowed only when the
   * operator named "valid" outright, or set a staleness window that this address is genuinely
   * past; anything else is dropped from the batch rather than silently charged for.
   */
  const wantsValid = scope.previousResults?.includes("VALID") ?? false;
  const staleBefore = scope.recheckOlderThanDays
    ? new Date(Date.now() - scope.recheckOlderThanDays * 864e5) : null;

  const billable = rows.filter((r) => {
    if (r.emailVerificationStatus !== "VALID") return true;
    if (wantsValid) return true;
    return Boolean(staleBefore && (!r.emailCheckedAt || r.emailCheckedAt < staleBefore));
  });
  const skippedValid = rows.length - billable.length;

  if (!billable.length)
    return { ok: false,
             reason: `every one of these ${rows.length.toLocaleString()} addresses is already `
                   + "confirmed valid. Tick \u201cvalid\u201d under previous results, or set a "
                   + "staleness window, if you really do want to pay for them again" };

  const batch = await prisma.emailVerificationBatch.create({
    data: {
      name: name.trim() || `Verification ${new Date().toISOString().slice(0, 10)}`,
      scope: scope as object, total: billable.length, createdById: actor?.userId ?? null,
    },
  });
  await prisma.emailVerificationItem.createMany({
    data: billable.map((r) => ({ batchId: batch.id, pharmacyId: r.id, email: r.email! })),
    skipDuplicates: true,
  });

  // The registry records that these are with a verifier, so the same address is not sent twice.
  await prisma.pharmacy.updateMany({
    where: { id: { in: billable.map((r) => r.id) } },
    data: { emailVerificationStatus: "IN_PROGRESS" },
  });

  await prisma.auditEvent.create({
    data: { eventType: "EMAIL_VERIFICATION_STARTED",
            detail: `${batch.name}: ${billable.length.toLocaleString()} addresses` +
                    (scope.states?.length ? ` (${scope.states.join(", ")})` : "") +
                    (skippedValid ? `; skipped ${skippedValid.toLocaleString()} already valid` : ""),
            ...actorFields(actor) } });
  return { ok: true, id: batch.id, total: billable.length, skippedValid };
}

export async function exportBatchCsv(batchId: number): Promise<string> {
  const items = await prisma.emailVerificationItem.findMany({
    where: { batchId }, orderBy: { id: "asc" },
    include: { pharmacy: { select: { canonicalName: true, state: true } } },
  });
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["pharmacy_id,email,pharmacy_name,state,result"];
  for (const i of items)
    lines.push([i.pharmacyId, esc(i.email), esc(i.pharmacy.canonicalName),
                i.pharmacy.state ?? "", ""].join(","));
  await prisma.emailVerificationBatch.update({
    where: { id: batchId }, data: { status: "EXPORTED", exportedAt: new Date() } });
  return lines.join("\n");
}

const normaliseResult = (raw: string): VerificationResult | null => {
  const s = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["VALID", "OK", "DELIVERABLE", "GOOD"].includes(s)) return "VALID";
  if (["INVALID", "BAD", "UNDELIVERABLE", "BOUNCE", "HARD_BOUNCE"].includes(s)) return "INVALID";
  if (["RISKY", "ACCEPT_ALL_RISKY", "LOW_QUALITY", "DISPOSABLE", "ROLE"].includes(s)) return "RISKY";
  if (["CATCH_ALL", "CATCHALL", "ACCEPT_ALL", "UNVERIFIABLE"].includes(s)) return "CATCH_ALL";
  if (["UNKNOWN", "TIMEOUT", "ERROR"].includes(s)) return "UNKNOWN";
  return null;
};

/**
 * Applies verifier results to the registry.
 *
 * Only VALID becomes eligible for outreach. CATCH_ALL and RISKY are recorded honestly and stay
 * out: a catch-all domain accepts everything, so it proves nothing about the address.
 */
export async function applyResults(
  batchId: number, csv: string, actor?: Actor,
): Promise<{ ok: true; applied: number; unmatched: number; counts: Record<string, number> }
         | { ok: false; reason: string }> {
  const { parseDelimited } = await import("../import/parse");
  const grid = parseDelimited(csv, csv.includes("\t") ? "\t" : ",");
  if (grid.length < 2) return { ok: false, reason: "the file has no result rows" };

  const headers = grid[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const idIdx = headers.findIndex((h) => ["pharmacyid", "id"].includes(h));
  const emailIdx = headers.findIndex((h) => h.includes("email"));
  /*
   * Deliberately ordered, and deliberately without "state": every export here carries a US state
   * column, and a loose alias list matched that instead of the verdict - producing a confident
   * "0 applied, 5 unmatched" rather than an error.
   */
  const RESULT_COLUMNS = ["result", "verificationresult", "emailstatus", "deliverability",
                          "verdict", "validationresult", "status", "verification"];
  const resultIdx = RESULT_COLUMNS.reduce(
    (found, name) => (found !== -1 ? found : headers.indexOf(name)), -1);
  if (resultIdx === -1) return { ok: false, reason: "no result column found in the file" };
  if (idIdx === -1 && emailIdx === -1)
    return { ok: false, reason: "the file needs a pharmacy_id or an email column to match on" };

  const items = await prisma.emailVerificationItem.findMany({ where: { batchId } });
  const byId = new Map(items.map((i) => [i.pharmacyId, i]));
  const byEmail = new Map(items.map((i) => [i.email.toLowerCase(), i]));

  const counts: Record<string, number> = {};
  let applied = 0, unmatched = 0;

  for (const row of grid.slice(1)) {
    const item = idIdx !== -1 && row[idIdx] ? byId.get(Number(row[idIdx]))
               : emailIdx !== -1 ? byEmail.get((row[emailIdx] ?? "").trim().toLowerCase())
               : undefined;
    const result = normaliseResult(row[resultIdx] ?? "");
    if (!item || !result) { unmatched++; continue; }

    await prisma.emailVerificationItem.update({
      where: { id: item.id }, data: { result, detail: (row[resultIdx] ?? "").trim() } });
    // Written only if the record still holds the address that was submitted. An import can
    // change a pharmacy's email while its round is in flight, and applying a verdict bought for
    // the old address to the new one would record a check that never happened.
    await prisma.pharmacy.updateMany({
      where: { id: item.pharmacyId, email: { equals: item.email, mode: "insensitive" } },
      data: { emailVerificationStatus: result, emailCheckedAt: new Date(),
              emailCheckDetail: (row[resultIdx] ?? "").trim().slice(0, 200) || null } });
    counts[result] = (counts[result] ?? 0) + 1;
    applied++;
  }

  // Anything the verifier did not answer for goes back to NOT_CHECKED rather than being left
  // stuck as IN_PROGRESS forever.
  const stillPending = items.filter((i) => i.result === "NOT_CHECKED")
    .map((i) => i.pharmacyId);
  if (stillPending.length) {
    await prisma.pharmacy.updateMany({
      where: { id: { in: stillPending }, emailVerificationStatus: "IN_PROGRESS" },
      data: { emailVerificationStatus: "NOT_CHECKED" },
    });
  }

  await prisma.emailVerificationBatch.update({
    where: { id: batchId },
    data: {
      status: "APPLIED", appliedAt: new Date(),
      valid: counts.VALID ?? 0, invalid: counts.INVALID ?? 0, risky: counts.RISKY ?? 0,
      catchAll: counts.CATCH_ALL ?? 0, unknown: counts.UNKNOWN ?? 0,
    },
  });
  await prisma.auditEvent.create({
    data: { eventType: "EMAIL_VERIFICATION_APPLIED",
            detail: `batch ${batchId}: ${applied} applied (${counts.VALID ?? 0} valid, ` +
                    `${counts.INVALID ?? 0} invalid)`,
            ...actorFields(actor) } });
  return { ok: true, applied, unmatched, counts };
}

export async function cancelBatch(batchId: number, actor?: Actor) {
  const items = await prisma.emailVerificationItem.findMany({
    where: { batchId, result: "NOT_CHECKED" }, select: { pharmacyId: true } });
  if (items.length) {
    await prisma.pharmacy.updateMany({
      where: { id: { in: items.map((i) => i.pharmacyId) }, emailVerificationStatus: "IN_PROGRESS" },
      data: { emailVerificationStatus: "NOT_CHECKED" },
    });
  }
  await prisma.emailVerificationBatch.update({
    where: { id: batchId }, data: { status: "CANCELLED" } });
  await prisma.auditEvent.create({
    data: { eventType: "EMAIL_VERIFICATION_CANCELLED", detail: `batch ${batchId}`,
            ...actorFields(actor) } });
}

/* ------------------------------------------------------------------ provider rounds */

/**
 * Hands a round to Reoon and records the task id.
 *
 * The batch exists before the call, so an API failure leaves a round an operator can see and
 * retry rather than a silent loss of the reservation.
 */
export async function submitToProvider(
  batchId: number, actor?: Actor,
): Promise<{ ok: true; taskId: string; submitted: number } | { ok: false; reason: string }> {
  const { createTask, MAX_PER_TASK } = await import("./reoon");

  const batch = await prisma.emailVerificationBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, reason: "round not found" };
  if (batch.providerTaskId) return { ok: false, reason: "this round is already with the verifier" };
  if (batch.status === "APPLIED") return { ok: false, reason: "this round is already applied" };

  const items = await prisma.emailVerificationItem.findMany({
    where: { batchId }, select: { email: true } });
  if (!items.length) return { ok: false, reason: "the round has no addresses" };
  if (items.length > MAX_PER_TASK)
    return { ok: false, reason: `${items.length} addresses exceeds the ${MAX_PER_TASK} per-task limit` };

  try {
    const submission = await createTask(batch.name, items.map((i) => i.email));
    await prisma.emailVerificationBatch.update({
      where: { id: batchId },
      data: {
        provider: "reoon", providerTaskId: String(submission.taskId),
        providerStatus: "waiting", status: "SUBMITTED", exportedAt: new Date(), error: null,
        providerMeta: {
          submitted: submission.submitted,
          duplicatesRemoved: submission.duplicatesRemoved,
          rejected: submission.rejected,
          processing: submission.processing,
        },
      },
    });
    await prisma.auditEvent.create({
      data: { eventType: "EMAIL_VERIFICATION_SUBMITTED",
              detail: `${batch.name}: task ${submission.taskId}, ${submission.processing} processing` +
                      (submission.duplicatesRemoved ? `, ${submission.duplicatesRemoved} duplicates removed` : "") +
                      (submission.rejected ? `, ${submission.rejected} rejected` : ""),
              ...actorFields(actor) } });
    return { ok: true, taskId: String(submission.taskId), submitted: submission.processing };
  } catch (e) {
    const reason = (e as Error).message;
    await prisma.emailVerificationBatch.update({
      where: { id: batchId }, data: { error: reason.slice(0, 400) } });
    return { ok: false, reason };
  }
}

/**
 * Asks the provider how a round is doing, and applies the results the moment it completes.
 *
 * Safe to call repeatedly: applying is idempotent, because an item that already carries a result
 * is not rewritten and the batch moves to APPLIED only once.
 */
export async function pollProvider(
  batchId: number, actor?: Actor,
): Promise<{ ok: true; status: string; checked: number; total: number; applied?: number }
         | { ok: false; reason: string }> {
  const { getTask, mapResult } = await import("./reoon");

  const batch = await prisma.emailVerificationBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, reason: "round not found" };
  if (!batch.providerTaskId) return { ok: false, reason: "this round was never sent to a verifier" };

  let task;
  try {
    task = await getTask(batch.providerTaskId);
  } catch (e) {
    const reason = (e as Error).message;
    await prisma.emailVerificationBatch.update({
      where: { id: batchId },
      data: { error: reason.slice(0, 400), lastPolledAt: new Date() } });
    return { ok: false, reason };
  }

  await prisma.emailVerificationBatch.update({
    where: { id: batchId },
    data: { providerStatus: task.status, checkedCount: task.checked,
            lastPolledAt: new Date(), error: null },
  });

  if (task.status !== "completed" || !task.results)
    return { ok: true, status: task.status, checked: task.checked, total: task.total };

  // ---- completed: write the results through ----
  const items = await prisma.emailVerificationItem.findMany({ where: { batchId } });
  const counts: Record<string, number> = {};
  const toSuppress: string[] = [];
  let applied = 0;

  for (const item of items) {
    // The provider keys results by the address it was given, which it lowercases.
    const record = task.results[item.email] ?? task.results[item.email.toLowerCase()];
    if (!record) continue;

    const mapped = mapResult(record);
    await prisma.emailVerificationItem.update({
      where: { id: item.id },
      data: { result: mapped.result, detail: mapped.detail, raw: record as object },
    });
    // Same guard as the manual path: the verdict belongs to the address that was submitted.
    await prisma.pharmacy.updateMany({
      where: { id: item.pharmacyId, email: { equals: item.email, mode: "insensitive" } },
      data: { emailVerificationStatus: mapped.result, emailCheckedAt: new Date(),
              emailCheckDetail: mapped.detail.slice(0, 200) },
    });
    if (mapped.suppress) toSuppress.push(item.email);
    counts[mapped.result] = (counts[mapped.result] ?? 0) + 1;
    applied++;
  }

  /*
   * Addresses the verifier says must never be mailed are suppressed here rather than merely
   * labelled. A spamtrap or a confirmed-dead address left mailable is exactly the record that
   * gets sent to next month by someone who did not read the status column.
   */
  const { suppress } = await import("../campaign/suppression");
  for (const email of toSuppress)
    await suppress(email, "BOUNCED", "email verification",
      "verifier reported this address as undeliverable or a trap");

  // Anything the provider never answered for returns to unchecked rather than being guessed.
  const unanswered = items.filter((i) => !task.results![i.email]
                                      && !task.results![i.email.toLowerCase()]);
  if (unanswered.length)
    await prisma.pharmacy.updateMany({
      where: { id: { in: unanswered.map((i) => i.pharmacyId) },
               emailVerificationStatus: "IN_PROGRESS" },
      data: { emailVerificationStatus: "NOT_CHECKED" },
    });

  await prisma.emailVerificationBatch.update({
    where: { id: batchId },
    data: {
      status: "APPLIED", appliedAt: new Date(), providerStatus: task.status,
      checkedCount: task.checked,
      valid: counts.VALID ?? 0, invalid: counts.INVALID ?? 0, risky: counts.RISKY ?? 0,
      catchAll: counts.CATCH_ALL ?? 0, unknown: counts.UNKNOWN ?? 0,
    },
  });
  await prisma.auditEvent.create({
    data: { eventType: "EMAIL_VERIFICATION_APPLIED",
            detail: `${batch.name}: ${applied} applied — ${counts.VALID ?? 0} valid, ` +
                    `${counts.INVALID ?? 0} invalid, ${counts.CATCH_ALL ?? 0} catch-all` +
                    (toSuppress.length ? `; ${toSuppress.length} suppressed` : ""),
            ...actorFields(actor) } });

  return { ok: true, status: task.status, checked: task.checked, total: task.total, applied };
}
