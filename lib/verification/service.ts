/**
 * The verification workspace.
 *
 * Every record arrives clean but unproven: the board file says a licence exists, not that the
 * business is open, independently owned and worth contacting. A human settles that, one record at
 * a time, and this is what they work in.
 *
 * A record becomes VERIFIED only when licence, ownership and operational status are all confirmed.
 * Those are the three the eligibility rules read; pharmacy type and contact details are recorded
 * for the deliverable but gate nothing.
 */
import { prisma } from "../db";
import { actorFields, type Actor } from "../audit";
import type { Prisma } from "@prisma/client";

/** The dimensions a record is checked on, in the order the workspace presents them. */
export const DIMENSIONS = [
  { type: "LICENSE", label: "Licence",
    help: "Is the licence live and in good standing with the board right now?",
    field: "licenseStatus",
    options: ["ACTIVE", "EXPIRED", "SUSPENDED", "REVOKED", "CLOSED", "UNKNOWN"],
    gating: true },
  { type: "OWNERSHIP", label: "Ownership",
    help: "Independently owned, or part of a chain or health system?",
    field: "ownershipStatus",
    options: ["INDEPENDENT", "LOCAL_GROUP", "CHAIN", "HOSPITAL", "GOVERNMENT", "LTC", "UNKNOWN"],
    gating: true },
  { type: "OPERATIONAL_STATUS", label: "Still trading",
    help: "Is the business open? A licence can outlive the shop.",
    field: "operationalStatus",
    options: ["OPEN", "CLOSED", "TEMPORARILY_CLOSED", "RELOCATED", "UNKNOWN"],
    gating: true },
  { type: "PHARMACY_TYPE", label: "Pharmacy type",
    help: "Retail, community, compounding, specialty — what they actually do.",
    field: "pharmacyType",
    options: ["COMMUNITY", "RETAIL", "COMPOUNDING", "SPECIALTY", "LONG_TERM_CARE",
              "MAIL_ORDER", "INSTITUTIONAL", "OTHER"],
    gating: false },
  { type: "CONTACT", label: "Contact details",
    help: "Are the phone, address and contact name current?",
    field: null, options: [] as string[], gating: false },
] as const;

export type DimensionType = (typeof DIMENSIONS)[number]["type"];
export const GATING_DIMENSIONS: DimensionType[] =
  DIMENSIONS.filter((d) => d.gating).map((d) => d.type);

export type QueueFilter = {
  states?: string[];
  dimension?: DimensionType;
  onlyNeedsReview?: boolean;
  search?: string;
};

export function queueWhere(f: QueueFilter): Prisma.PharmacyWhereInput {
  const where: Prisma.PharmacyWhereInput = {
    verificationStatus: { in: f.onlyNeedsReview
      ? ["NEEDS_REVIEW"]
      : ["READY_FOR_VERIFICATION", "IN_VERIFICATION", "NEEDS_REVIEW"] },
  };
  if (f.states?.length) where.state = { in: f.states };
  if (f.dimension)
    where.tasks = { some: { verificationType: f.dimension,
                            status: { in: ["NOT_STARTED", "IN_PROGRESS"] } } };
  if (f.search?.trim()) {
    const q = f.search.trim();
    where.OR = [
      { canonicalName: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { primaryLicenseNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

/**
 * The next record to work.
 *
 * Ordered so the most useful work comes first: records already flagged for review, then those
 * that hold an email — verifying a pharmacy with no way to contact it earns nothing until an
 * address turns up.
 */
export async function nextInQueue(f: QueueFilter, skipIds: number[] = []) {
  const where = queueWhere(f);
  const pharmacy = await prisma.pharmacy.findFirst({
    where: skipIds.length ? { ...where, id: { notIn: skipIds } } : where,
    orderBy: [{ verificationStatus: "asc" }, { email: { sort: "desc", nulls: "last" } },
              { id: "asc" }],
    include: {
      tasks: { orderBy: { verificationType: "asc" } },
      provenance: { orderBy: { authorityRank: "asc" }, take: 24 },
      importBatch: true,
      contacts: true,
      identifiers: true,
    },
  });
  if (!pharmacy) return null;

  // VerificationResult carries a pharmacy id but no relation, so it is fetched alongside.
  const history = await prisma.verificationResult.findMany({
    where: { pharmacyId: pharmacy.id }, orderBy: { verifiedAt: "desc" }, take: 20 });
  return { pharmacy, history };
}

export type Verdict = "CONFIRMED" | "FAILED" | "UNCERTAIN";

export type DimensionSubmission = {
  type: DimensionType;
  verdict: Verdict;
  value?: string;
  evidenceSource?: string;
  evidenceUrl?: string;
  notes?: string;
};

export type VerifyOutcome = {
  pharmacyId: number;
  recorded: number;
  status: string;
  becameVerified: boolean;
};

/**
 * Records one operator's findings for one pharmacy.
 *
 * Everything written carries who said it, when, and what they looked at. A verification with no
 * evidence behind it is an opinion, and the deliverable presents these as checked facts.
 */
export async function submitVerification(
  pharmacyId: number, submissions: DimensionSubmission[], actor: Actor,
): Promise<VerifyOutcome> {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId }, include: { tasks: true } });
  if (!pharmacy) throw new Error("pharmacy not found");

  const now = new Date();
  const patch: Record<string, unknown> = {};
  let recorded = 0;

  for (const s of submissions) {
    const dimension = DIMENSIONS.find((d) => d.type === s.type);
    if (!dimension) continue;

    const task = pharmacy.tasks.find((t) => t.verificationType === s.type);
    if (task) {
      await prisma.verificationTask.update({
        where: { id: task.id },
        data: {
          status: s.verdict === "UNCERTAIN" ? "BLOCKED" : "COMPLETED",
          result: s.verdict, notes: s.notes?.trim() || null,
          startedAt: task.startedAt ?? now, completedAt: now,
        },
      });
      await prisma.verificationResult.create({
        data: {
          taskId: task.id, pharmacyId, verificationType: s.type, result: s.verdict,
          verifiedBy: actor.email, verifiedAt: now,
          evidenceSource: s.evidenceSource?.trim() || null,
          evidenceUrl: s.evidenceUrl?.trim() || null,
          notes: s.notes?.trim() || null,
        },
      });
      recorded++;
    }

    // A confirmed observation updates the field the eligibility rules read.
    if (s.verdict === "CONFIRMED" && dimension.field && s.value)
      patch[dimension.field] = s.value;
  }

  /*
   * The record's own status.
   *
   * VERIFIED needs all three gating dimensions confirmed. Anything failed makes it EXCLUDED — a
   * closed shop or a chain is not a near miss. Anything uncertain leaves it NEEDS_REVIEW rather
   * than letting an unresolved question pass as a yes.
   */
  const results = await prisma.verificationResult.findMany({
    where: { pharmacyId, verificationType: { in: GATING_DIMENSIONS } },
    orderBy: { verifiedAt: "desc" },
  });
  const latest = new Map<string, string>();
  for (const r of results)
    if (!latest.has(r.verificationType)) latest.set(r.verificationType, r.result);

  const verdicts = GATING_DIMENSIONS.map((d) => latest.get(d));
  const status = verdicts.includes("FAILED") ? "EXCLUDED"
    : verdicts.every((v) => v === "CONFIRMED") ? "VERIFIED"
    : verdicts.includes("UNCERTAIN") ? "NEEDS_REVIEW"
    : "IN_VERIFICATION";

  patch.verificationStatus = status;
  patch.verifiedAt = now;
  patch.licenseVerificationStatus = latest.get("LICENSE") ? "COMPLETED" : "NOT_STARTED";
  patch.ownershipVerificationStatus = latest.get("OWNERSHIP") ? "COMPLETED" : "NOT_STARTED";
  patch.operationalVerificationStatus = latest.get("OPERATIONAL_STATUS") ? "COMPLETED" : "NOT_STARTED";

  if (status === "EXCLUDED") {
    const failed = GATING_DIMENSIONS.find((d) => latest.get(d) === "FAILED");
    patch.exclusionReason = `verification: ${failed?.toLowerCase().replace(/_/g, " ")} failed`;
    patch.campaignEligible = false;
  }
  if (status === "VERIFIED") patch.campaignEligible = true;

  await prisma.pharmacy.update({ where: { id: pharmacyId }, data: patch });
  await prisma.auditEvent.create({
    data: {
      eventType: status === "VERIFIED" ? "PHARMACY_VERIFIED" : "VERIFICATION_RECORDED",
      pharmacyId,
      detail: `${recorded} dimension(s) · ${pharmacy.verificationStatus} → ${status}`,
      ...actorFields(actor),
    },
  });

  return { pharmacyId, recorded, status,
           becameVerified: status === "VERIFIED" && pharmacy.verificationStatus !== "VERIFIED" };
}

/** Queue counts, so an operator sees what is left without paging through it. */
export async function queueStats(f: QueueFilter = {}) {
  const where = queueWhere(f);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [remaining, byState, byStatus, doneToday, verifiedTotal, eligibleTotal] = await Promise.all([
    prisma.pharmacy.count({ where }),
    prisma.pharmacy.groupBy({ by: ["state"], where, _count: true,
                              orderBy: { _count: { state: "desc" } } }),
    prisma.pharmacy.groupBy({ by: ["verificationStatus"], where, _count: true }),
    prisma.verificationResult.count({ where: { verifiedAt: { gte: startOfDay } } }),
    prisma.pharmacy.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.pharmacy.count({ where: {
      verificationStatus: "VERIFIED", licenseStatus: "ACTIVE", operationalStatus: "OPEN",
      ownershipStatus: { in: ["INDEPENDENT", "LOCAL_GROUP"] },
      emailVerificationStatus: "VALID", email: { not: null },
    } }),
  ]);
  return {
    remaining,
    byState: byState.map((s) => ({ state: s.state ?? "unknown", count: s._count })),
    byStatus: byStatus.map((s) => ({ status: s.verificationStatus, count: s._count })),
    doneToday, verifiedTotal, eligibleTotal,
  };
}
