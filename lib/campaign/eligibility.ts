import { prisma } from "../db";
import { config, liveRecipientAllowed, liveSendingAllowed } from "../config";

/**
 * Server-side recipient eligibility. Enforced at FOUR points - selection, campaign creation,
 * queueing, and immediately before send - because state can change between them.
 *
 * A pharmacy that was verified when the campaign was built may have been excluded by the time
 * its message is due. The last check is the one that actually protects us.
 */
export type Blocked = { eligible: false; reason: string };
export type Eligible = { eligible: true; reason: "" };
export type Verdict = Blocked | Eligible;

const OK: Eligible = { eligible: true, reason: "" };
const no = (reason: string): Blocked => ({ eligible: false, reason });

export const ELIGIBILITY_RULES = [
  "verification_status = VERIFIED",
  "license_status = ACTIVE",
  "operational_status = OPEN",
  "ownership_status in (INDEPENDENT, LOCAL_GROUP)",
  "email_verification_status = VALID",
  "email present",
  "not on the suppression list",
] as const;

export type PharmacyLike = {
  id: number;
  email: string | null;
  verificationStatus: string;
  licenseStatus: string | null;
  operationalStatus: string;
  ownershipStatus: string;
  emailVerificationStatus: string;
};

/** Pure business rules, no I/O, so this is trivially testable. */
export function checkPharmacy(p: PharmacyLike): Verdict {
  if (!p.email) return no("no email address");
  if (p.verificationStatus !== "VERIFIED")
    return no(`not verified (${p.verificationStatus})`);
  if ((p.licenseStatus ?? "UNKNOWN").toUpperCase() !== "ACTIVE")
    return no(`licence not active (${p.licenseStatus ?? "UNKNOWN"})`);
  if (p.operationalStatus !== "OPEN")
    return no(`operational status ${p.operationalStatus}`);
  if (!["INDEPENDENT", "LOCAL_GROUP"].includes(p.ownershipStatus))
    return no(`ownership ${p.ownershipStatus}`);
  if (p.emailVerificationStatus !== "VALID")
    return no(`email not verified (${p.emailVerificationStatus})`);
  return OK;
}

/** Full check including the global suppression list. */
export async function checkRecipient(p: PharmacyLike): Promise<Verdict> {
  const base = checkPharmacy(p);
  if (!base.eligible) return base;
  const sup = await prisma.suppressionEntry.findUnique({
    where: { email: p.email!.toLowerCase() },
  });
  if (sup) return no(`suppressed (${sup.reason})`);
  return OK;
}

/**
 * The final gate, immediately before the provider call. In live mode an address must ALSO be on
 * the explicit test allowlist - an empty allowlist blocks everything, which is the safe default.
 */
export async function checkSendable(p: PharmacyLike): Promise<Verdict> {
  const verdict = await checkRecipient(p);
  if (!verdict.eligible) return verdict;
  if (config.emailMode === "gmail") {
    const live = liveSendingAllowed();
    if (live.allowed && !liveRecipientAllowed(p.email!))
      return no("live mode: address is not on LIVE_EMAIL_TEST_ALLOWLIST");
  }
  return OK;
}

/** Bulk pre-flight used by the campaign review screen. */
export async function summarise(pharmacyIds: number[]) {
  const rows = await prisma.pharmacy.findMany({
    where: { id: { in: pharmacyIds } },
    select: {
      id: true, email: true, verificationStatus: true, licenseStatus: true,
      operationalStatus: true, ownershipStatus: true, emailVerificationStatus: true,
    },
  });
  const emails = rows.map((r) => r.email).filter(Boolean) as string[];
  const suppressed = new Set(
    (await prisma.suppressionEntry.findMany({
      where: { email: { in: emails.map((e) => e.toLowerCase()) } }, select: { email: true },
    })).map((s) => s.email));

  const out = { total: rows.length, eligible: 0, missingEmail: 0, suppressed: 0,
                notVerified: 0, otherBlocked: 0, reasons: {} as Record<string, number> };
  for (const r of rows) {
    if (!r.email) { out.missingEmail++; out.reasons["no email address"] = (out.reasons["no email address"] ?? 0) + 1; continue; }
    if (suppressed.has(r.email.toLowerCase())) { out.suppressed++; out.reasons["suppressed"] = (out.reasons["suppressed"] ?? 0) + 1; continue; }
    const v = checkPharmacy(r);
    if (v.eligible) { out.eligible++; continue; }
    if (v.reason.startsWith("not verified")) out.notVerified++; else out.otherBlocked++;
    out.reasons[v.reason] = (out.reasons[v.reason] ?? 0) + 1;
  }
  return out;
}
