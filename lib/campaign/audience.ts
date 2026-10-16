/**
 * Choosing who a campaign goes to.
 *
 * Filters narrow the pool; they never widen it. Everything selected here still passes the six
 * eligibility rules before it is queued and again immediately before each send - a filter is a
 * way of sending to fewer people, never a way of reaching someone the rules exclude.
 */
import { prisma } from "../db";
import type { Prisma } from "@prisma/client";

export type AudienceFilter = {
  states?: string[];
  /** COMMUNITY, COMPOUNDING, SPECIALTY, RETAIL … as held on the record. */
  pharmacyTypes?: string[];
  /** PERSONAL (a named person) or SHARED (info@, pharmacy@). Empty means both. */
  emailKinds?: string[];
  /** Skip anyone this registry has already written to, in any campaign. */
  excludeContacted?: boolean;
  /** Skip anyone already on this campaign's recipient list. */
  excludeAlreadyOnCampaign?: number;
  /** Free-text match on name or city. */
  search?: string;
  /** Take at most this many, lowest id first, so a repeat build is deterministic. */
  limit?: number;
};

/**
 * The six eligibility rules, as a query.
 *
 * Mirrors checkPharmacy() in eligibility.ts. Kept in step by the test that asserts a pharmacy
 * matching this query also passes the function - two expressions of one rule set will drift
 * apart otherwise, and the drift would be silent.
 */
export const ELIGIBLE_WHERE: Prisma.PharmacyWhereInput = {
  email: { not: null },
  verificationStatus: "VERIFIED",
  licenseStatus: "ACTIVE",
  operationalStatus: "OPEN",
  ownershipStatus: { in: ["INDEPENDENT", "LOCAL_GROUP"] },
  emailVerificationStatus: "VALID",
};

export function audienceWhere(f: AudienceFilter): Prisma.PharmacyWhereInput {
  const where: Prisma.PharmacyWhereInput = {};

  if (f.states?.length) where.state = { in: f.states };
  if (f.pharmacyTypes?.length) where.pharmacyType = { in: f.pharmacyTypes };
  if (f.emailKinds?.length) where.emailKind = { in: f.emailKinds };
  if (f.excludeContacted) where.leadStatus = "NOT_CONTACTED";
  if (f.excludeAlreadyOnCampaign)
    where.campaignRecipients = { none: { campaignId: f.excludeAlreadyOnCampaign } };
  if (f.search?.trim()) {
    const q = f.search.trim();
    where.OR = [
      { canonicalName: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export type AudiencePreview = {
  matching: number;
  eligible: number;
  blocked: number;
  /** Why the non-eligible ones are out, so the number is never a mystery. */
  reasons: { reason: string; count: number }[];
  byState: { state: string; count: number }[];
  suppressed: number;
};

/**
 * What this filter would actually queue, before anything is built.
 *
 * The blocked breakdown matters more than the total: "1,200 matched, 0 eligible" is useless on its
 * own and obvious once it says 1,200 are unverified.
 */
export async function previewAudience(f: AudienceFilter): Promise<AudiencePreview> {
  const base = audienceWhere(f);

  const [matching, eligible, byState] = await Promise.all([
    prisma.pharmacy.count({ where: base }),
    prisma.pharmacy.count({ where: { ...base, ...ELIGIBLE_WHERE } }),
    prisma.pharmacy.groupBy({
      by: ["state"], where: { ...base, ...ELIGIBLE_WHERE }, _count: true,
      orderBy: { _count: { state: "desc" } },
    }),
  ]);

  // Each count is of records failing that rule alone among those matching the filter.
  const counts = await Promise.all([
    prisma.pharmacy.count({ where: { ...base, email: null } }),
    prisma.pharmacy.count({ where: { ...base, email: { not: null },
                                     verificationStatus: { not: "VERIFIED" } } }),
    prisma.pharmacy.count({ where: { ...base, email: { not: null },
                                     verificationStatus: "VERIFIED",
                                     emailVerificationStatus: { not: "VALID" } } }),
    prisma.pharmacy.count({ where: { ...base, email: { not: null },
                                     verificationStatus: "VERIFIED",
                                     emailVerificationStatus: "VALID",
                                     licenseStatus: { not: "ACTIVE" } } }),
    prisma.pharmacy.count({ where: { ...base, email: { not: null },
                                     verificationStatus: "VERIFIED",
                                     emailVerificationStatus: "VALID",
                                     licenseStatus: "ACTIVE",
                                     operationalStatus: { not: "OPEN" } } }),
    prisma.pharmacy.count({ where: { ...base, email: { not: null },
                                     verificationStatus: "VERIFIED",
                                     emailVerificationStatus: "VALID",
                                     licenseStatus: "ACTIVE", operationalStatus: "OPEN",
                                     ownershipStatus: { notIn: ["INDEPENDENT", "LOCAL_GROUP"] } } }),
  ]);

  const labels = [
    "no email address",
    "not business-verified yet",
    "email not verified as valid",
    "licence not active",
    "not recorded as open",
    "ownership not independent",
  ];
  const reasons = labels
    .map((reason, i) => ({ reason, count: counts[i] }))
    .filter((r) => r.count > 0);

  // Suppressed addresses are eligible by every other rule but can never be sent to.
  const eligibleEmails = await prisma.pharmacy.findMany({
    where: { ...base, ...ELIGIBLE_WHERE }, select: { email: true }, take: 10000 });
  const suppressed = eligibleEmails.length
    ? await prisma.suppressionEntry.count({
        where: { email: { in: eligibleEmails.map((e) => e.email!.toLowerCase()) } } })
    : 0;

  return {
    matching, eligible, blocked: matching - eligible, reasons,
    byState: byState.map((s) => ({ state: s.state ?? "unknown", count: s._count })),
    suppressed,
  };
}

/** The distinct values available to filter on, counted so empty options are not offered. */
export async function audienceOptions() {
  const [states, types, kinds] = await Promise.all([
    prisma.pharmacy.groupBy({ by: ["state"], _count: true, orderBy: { state: "asc" } }),
    prisma.pharmacy.groupBy({ by: ["pharmacyType"], _count: true,
                              orderBy: { _count: { pharmacyType: "desc" } } }),
    prisma.pharmacy.groupBy({ by: ["emailKind"], where: { email: { not: null } }, _count: true }),
  ]);
  return {
    states: states.filter((s) => s.state).map((s) => ({ value: s.state!, count: s._count })),
    types: types.filter((t) => t.pharmacyType)
      .map((t) => ({ value: t.pharmacyType!, count: t._count })),
    kinds: kinds.map((k) => ({ value: k.emailKind, count: k._count })),
  };
}
