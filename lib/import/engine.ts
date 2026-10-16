/**
 * The preprocessing chain, in the order it runs.
 *
 * Every row gets exactly one decision and the rule that made it, so an aggregate count is always
 * traceable back to individual rows. Order matters: the cheap, definitive exclusions come first,
 * and deduplication comes last so that a row is only compared against rows that survived.
 */
import type { CanonicalField } from "./fields";
import {
  classifyEmail, normalizeCity, normalizeName, normalizeNcpdp, normalizeNpi,
  normalizePhone, normalizeState, normalizeStreet, normalizeWebsite, normalizeZip,
  normalizeLicenseNumber, type EmailKind,
} from "./normalize";
import { classify, classifyLicenceType, isOpen } from "./classify";

export type RawRow = Record<string, string>;
export type Mapping = Partial<Record<CanonicalField, string>>;

export type CleanedRow = {
  name: string | null;
  doingBusinessAs: string | null;
  email: string | null;
  emailKind: EmailKind;
  phone: string | null;
  website: string | null;
  streetAddress: string | null;
  addressLine2: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zipCode: string | null;
  licenseNumber: string | null;
  licenseStatus: string | null;
  licenseType: string | null;
  pharmacyType: string | null;
  ownerName: string | null;
  picName: string | null;
  npi: string | null;
  ncpdpId: string | null;
};

export type RowVerdict = {
  rowNumber: number;
  raw: RawRow;
  cleaned: CleanedRow;
  decision: "ACCEPTED" | "REVIEW" | "EXCLUDED";
  rule: string;
  reason: string;
  notes: string[];
};

/** Declared in the order they run, and shown to the operator in the same order. */
export const RULES = [
  { id: "no-name", label: "No pharmacy name",
    detail: "A row without a name cannot be matched, deduplicated or addressed." },
  { id: "licence-closed", label: "Licence not open",
    detail: "Closed, expired, revoked, suspended or surrendered licences are excluded." },
  { id: "licence-type", label: "Licence type excluded",
    detail: "Wholesalers, manufacturers, institutional, veterinary, mail-service and similar classes." },
  { id: "non-resident", label: "Non-resident licensee",
    detail: "Licensed into the state from outside it — shipped into, but not located in, the state." },
  { id: "chain", label: "Chain outlet",
    detail: "National and regional chains and supermarket banners. Independent franchise banners are kept." },
  { id: "hospital", label: "Hospital or health system", detail: "Not an independent buyer." },
  { id: "government", label: "Government or military", detail: "Not a commercial customer." },
  { id: "ltc", label: "Long-term care", detail: "Institutional dispensing rather than retail." },
  { id: "mail-order", label: "Mail order", detail: "Central-fill and home-delivery operations." },
  { id: "duplicate", label: "Duplicate within the file",
    detail: "Same name, street and ZIP as a row already accepted from this file." },
  { id: "store-number", label: "Store-number pattern",
    detail: "Sent to review: a numbered store name suggests a chain whose brand we do not recognise." },
  { id: "store-department", label: "Pharmacy department",
    detail: "Sent to review: a counter inside a supermarket is a chain outlet." },
  { id: "licence-status-unknown", label: "Licence status not stated",
    detail: "Sent to review rather than assumed open." },
] as const;

export type RuleId = (typeof RULES)[number]["id"];

const pick = (row: RawRow, mapping: Mapping, field: CanonicalField): string | null => {
  const column = mapping[field];
  if (!column) return null;
  const v = row[column];
  return v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim();
};

export function cleanRow(row: RawRow, mapping: Mapping): { cleaned: CleanedRow; notes: string[] } {
  const notes: string[] = [];
  const rawEmail = pick(row, mapping, "email");
  const verdict = classifyEmail(rawEmail);

  if (!verdict.ok) notes.push(verdict.reason);
  else if (verdict.kind === "SHARED") notes.push("shared inbox rather than a named person");

  const phone = normalizePhone(pick(row, mapping, "phone"));
  if (!phone && pick(row, mapping, "phone")) notes.push("phone present but not a usable US number");

  const state = normalizeState(pick(row, mapping, "state"));
  if (!state && pick(row, mapping, "state")) notes.push("state not recognised");

  const npiRaw = pick(row, mapping, "npi");
  const npi = normalizeNpi(npiRaw);
  if (npiRaw && !npi) notes.push("NPI failed its check digit and was dropped");

  const cleaned: CleanedRow = {
    name: normalizeName(pick(row, mapping, "name")),
    doingBusinessAs: normalizeName(pick(row, mapping, "doingBusinessAs")),
    email: verdict.ok ? verdict.email : null,
    emailKind: verdict.ok ? verdict.kind : "UNKNOWN",
    phone,
    website: normalizeWebsite(pick(row, mapping, "website")),
    streetAddress: normalizeStreet(pick(row, mapping, "streetAddress")),
    addressLine2: normalizeStreet(pick(row, mapping, "addressLine2")),
    city: normalizeCity(pick(row, mapping, "city")),
    county: pick(row, mapping, "county"),
    state,
    zipCode: normalizeZip(pick(row, mapping, "zipCode")),
    licenseNumber: normalizeLicenseNumber(pick(row, mapping, "licenseNumber")),
    licenseStatus: pick(row, mapping, "licenseStatus"),
    licenseType: pick(row, mapping, "licenseType"),
    pharmacyType: pick(row, mapping, "pharmacyType"),
    ownerName: normalizeName(pick(row, mapping, "ownerName")),
    picName: normalizeName(pick(row, mapping, "picName")),
    npi,
    ncpdpId: normalizeNcpdp(pick(row, mapping, "ncpdpId")),
  };
  return { cleaned, notes };
}

/** Same key the acquisition pipeline used, so a re-import recognises what it already curated. */
export function dedupeKey(c: CleanedRow): string {
  const name = (c.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const street = (c.streetAddress ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
  return `${name}|${street}|${c.zipCode ?? ""}`;
}

export type Analysis = {
  totalRows: number;
  accepted: number;
  review: number;
  excluded: number;
  /** Rule id -> how many rows it removed or flagged. */
  ruleCounts: Record<string, number>;
  withEmail: number;
  withPhone: number;
  sharedInboxes: number;
  byState: Record<string, number>;
  /** Accepted rows already present in this same file, before dedupe removed them. */
  duplicates: number;
};

export function runRules(rows: RawRow[], mapping: Mapping): {
  verdicts: RowVerdict[]; analysis: Analysis;
} {
  const verdicts: RowVerdict[] = [];
  const ruleCounts: Record<string, number> = {};
  const byState: Record<string, number> = {};
  const seen = new Set<string>();
  const bump = (id: string) => { ruleCounts[id] = (ruleCounts[id] ?? 0) + 1; };

  rows.forEach((raw, i) => {
    const rowNumber = i + 1;
    const { cleaned, notes } = cleanRow(raw, mapping);

    const exclude = (rule: RuleId, reason: string): RowVerdict => {
      bump(rule);
      return { rowNumber, raw, cleaned, decision: "EXCLUDED", rule, reason, notes };
    };
    const review = (rule: RuleId, reason: string): RowVerdict => {
      bump(rule);
      return { rowNumber, raw, cleaned, decision: "REVIEW", rule, reason, notes };
    };

    // 1. A row with no name is not a pharmacy record.
    if (!cleaned.name) { verdicts.push(exclude("no-name", "no pharmacy name in this row")); return; }

    // 2. Licence status. Not stated is reviewed, never assumed open.
    const open = isOpen(cleaned.licenseStatus);
    if (open === false) {
      verdicts.push(exclude("licence-closed", `licence status "${cleaned.licenseStatus}"`)); return;
    }

    // 3. Licence type, including non-resident permits.
    const byType = classifyLicenceType(cleaned.licenseType);
    if (byType.decision === "EXCLUDE") {
      const rule = byType.rule === "non-resident" ? "non-resident" : "licence-type";
      verdicts.push(exclude(rule as RuleId, byType.reason)); return;
    }

    // 4. Boards that flag non-residents in the county field rather than the licence type.
    if ((cleaned.county ?? "").trim().toLowerCase() === "out of state") {
      verdicts.push(exclude("non-resident", "county says out of state")); return;
    }

    // 5. Chain, institution, government, LTC and mail-order detection on the names.
    const byName = classify(cleaned.name, cleaned.doingBusinessAs, cleaned.licenseType,
                            cleaned.pharmacyType);
    if (byName.decision === "EXCLUDE") {
      verdicts.push(exclude(byName.rule as RuleId, byName.reason)); return;
    }

    // 6. Deduplicate against rows already accepted from this same file.
    const key = dedupeKey(cleaned);
    if (seen.has(key)) {
      verdicts.push(exclude("duplicate", "same name, street and ZIP as an earlier row")); return;
    }
    seen.add(key);

    // 7. Everything that survived is in. Some of it still needs a human.
    if (byName.decision === "REVIEW") { verdicts.push(review(byName.rule as RuleId, byName.reason)); return; }
    if (byType.decision === "REVIEW") { verdicts.push(review("licence-type", byType.reason)); return; }
    if (open === null) {
      verdicts.push(review("licence-status-unknown",
        cleaned.licenseStatus
          ? `licence status "${cleaned.licenseStatus}" not recognised`
          : "no licence status given"));
      return;
    }

    verdicts.push({ rowNumber, raw, cleaned, decision: "ACCEPTED", rule: "none",
                    reason: "passed every rule", notes });
  });

  const kept = verdicts.filter((v) => v.decision !== "EXCLUDED");
  for (const v of kept) {
    const st = v.cleaned.state ?? "unknown";
    byState[st] = (byState[st] ?? 0) + 1;
  }

  return {
    verdicts,
    analysis: {
      totalRows: rows.length,
      accepted: verdicts.filter((v) => v.decision === "ACCEPTED").length,
      review: verdicts.filter((v) => v.decision === "REVIEW").length,
      excluded: verdicts.filter((v) => v.decision === "EXCLUDED").length,
      ruleCounts,
      withEmail: kept.filter((v) => v.cleaned.email).length,
      withPhone: kept.filter((v) => v.cleaned.phone).length,
      sharedInboxes: kept.filter((v) => v.cleaned.emailKind === "SHARED").length,
      byState,
      duplicates: ruleCounts["duplicate"] ?? 0,
    },
  };
}
