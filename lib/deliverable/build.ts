/**
 * The client's deliverable: eight named tabs, in the order and with the columns they specified.
 *
 * Built straight from the registry, so the file can never disagree with the system. Every column
 * the brief asks for is present; where the data genuinely does not exist the cell is empty rather
 * than filled with a guess, and the summary says how many are empty.
 */
import { prisma } from "../db";

export const TABS = [
  "Verified Independent Pharmacies",
  "Valid Emails for Campaign",
  "Complete Call List",
  "Catch-All and Risky Emails",
  "No Email Found",
  "Needs Review",
  "Excluded Chains and Duplicates",
  "State-by-State Summary",
] as const;
export type TabName = (typeof TABS)[number];

/** Exactly the columns the brief lists, in the brief's order. */
export const COLUMNS = [
  "Pharmacy Name", "Pharmacy Type", "Owner / Buyer / PIC", "Business Phone",
  "Public Business Email", "Website", "Street Address", "City", "County", "State", "ZIP Code",
  "Google Maps Link", "State License Number", "License Status", "Number of Locations",
  "Email Source", "Email Verification Result", "Date Verified", "Notes",
] as const;

export type Row = (string | number)[];
export type Sheet = { name: string; columns: readonly string[]; rows: Row[] };

const mapsLink = (p: {
  canonicalName: string; streetAddress: string | null; city: string | null;
  state: string | null; zipCode: string | null;
}) => {
  const q = [p.canonicalName, p.streetAddress, p.city, p.state, p.zipCode]
    .filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
};

const RESULT_LABEL: Record<string, string> = {
  VALID: "Valid", INVALID: "Invalid", RISKY: "Risky", CATCH_ALL: "Catch-All",
  UNKNOWN: "Unknown", NOT_CHECKED: "Not yet verified", IN_PROGRESS: "With verifier",
};

const select = {
  id: true, canonicalName: true, pharmacyType: true, ownerName: true, picName: true,
  buyerName: true, phone: true, email: true, website: true, streetAddress: true, city: true,
  county: true, state: true, zipCode: true, primaryLicenseNumber: true, licenseStatus: true,
  numberOfLocations: true, emailSource: true, emailVerificationStatus: true, emailKind: true,
  verifiedAt: true, notes: true, exclusionReason: true, verificationStatus: true,
} as const;

type Record_ = Awaited<ReturnType<typeof fetchAll>>[number];
const fetchAll = () => prisma.pharmacy.findMany({ select, orderBy: [{ state: "asc" }, { city: "asc" }] });

function toRow(p: Record_): Row {
  return [
    p.canonicalName,
    p.pharmacyType ?? "",
    p.ownerName ?? p.buyerName ?? p.picName ?? "",
    p.phone ?? "",
    p.email ?? "",
    p.website ?? "",
    p.streetAddress ?? "",
    p.city ?? "",
    p.county ?? "",
    p.state ?? "",
    p.zipCode ?? "",
    mapsLink(p),
    p.primaryLicenseNumber ?? "",
    p.licenseStatus ?? "",
    p.numberOfLocations ?? "",
    p.emailSource ?? "",
    RESULT_LABEL[p.emailVerificationStatus] ?? p.emailVerificationStatus,
    p.verifiedAt ? p.verifiedAt.toISOString().slice(0, 10) : "",
    [p.notes, p.emailKind === "SHARED" ? "shared inbox, not a named person" : null]
      .filter(Boolean).join(" · "),
  ];
}

export type DeliverableOptions = {
  /** Restrict to these states. Empty means every state held. */
  states?: string[];
  /** Sample mode: at most this many verified pharmacies, spread across as many states as possible. */
  sampleSize?: number;
};

export type Deliverable = {
  sheets: Sheet[];
  summary: FinalReport;
};

export type FinalReport = {
  generatedAt: string;
  totalIndependentPharmacies: number;
  totalValidEmails: number;
  totalWithoutEmail: number;
  totalChainsRemoved: number;
  totalClosedRemoved: number;
  totalDuplicatesRemoved: number;
  totalActiveLicensesVerified: number;
  statesCovered: string[];
  emailsNotYetVerified: number;
  toolsUsed: string[];
  caveats: string[];
};

export async function buildDeliverable(options: DeliverableOptions = {}): Promise<Deliverable> {
  const all = await fetchAll();
  const inStates = (p: Record_) =>
    !options.states?.length || (p.state ? options.states.includes(p.state) : false);

  const scoped = all.filter(inStates);
  const clean = scoped.filter((p) => p.verificationStatus === "READY_FOR_VERIFICATION"
                                  || p.verificationStatus === "VERIFIED");
  const review = scoped.filter((p) => p.verificationStatus === "NEEDS_REVIEW");
  const excluded = scoped.filter((p) => p.verificationStatus === "EXCLUDED");

  // Sample mode spreads the take across states rather than returning one state's worth.
  const verified = options.sampleSize ? spread(clean, options.sampleSize) : clean;

  const valid = verified.filter((p) => p.emailVerificationStatus === "VALID");
  const catchAllRisky = verified.filter((p) =>
    ["CATCH_ALL", "RISKY", "UNKNOWN"].includes(p.emailVerificationStatus));
  const noEmail = verified.filter((p) => !p.email);
  const withPhone = verified.filter((p) => p.phone);

  const sheets: Sheet[] = [
    { name: TABS[0], columns: COLUMNS, rows: verified.map(toRow) },
    { name: TABS[1], columns: COLUMNS, rows: valid.map(toRow) },
    { name: TABS[2], columns: COLUMNS, rows: withPhone.map(toRow) },
    { name: TABS[3], columns: COLUMNS, rows: catchAllRisky.map(toRow) },
    { name: TABS[4], columns: COLUMNS, rows: noEmail.map(toRow) },
    {
      name: TABS[5],
      columns: [...COLUMNS, "Why It Needs Review"],
      rows: review.map((p) => [...toRow(p), p.exclusionReason ?? ""]),
    },
    {
      name: TABS[6],
      columns: ["Pharmacy Name", "City", "State", "Email", "Reason Excluded"],
      rows: excluded.map((p) => [p.canonicalName, p.city ?? "", p.state ?? "", p.email ?? "",
                                 p.exclusionReason ?? ""]),
    },
    { name: TABS[7], columns: stateSummaryColumns, rows: stateSummary(scoped) },
  ];

  return { sheets, summary: report(all, scoped, verified, valid, excluded) };
}

/** Takes n records spread as evenly as possible across the states present. */
function spread<T extends { state: string | null }>(rows: T[], n: number): T[] {
  const byState = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.state ?? "—";
    (byState.get(k) ?? byState.set(k, []).get(k)!).push(r);
  }
  const out: T[] = [];
  const queues = [...byState.values()];
  let i = 0;
  while (out.length < n && queues.some((q) => q.length)) {
    const q = queues[i % queues.length];
    const next = q.shift();
    if (next) out.push(next);
    i++;
  }
  return out;
}

const stateSummaryColumns = [
  "State", "Verified Independent Pharmacies", "Valid Emails", "Catch-All / Risky",
  "Not Yet Verified", "No Email", "With Phone", "Needs Review", "Excluded",
] as const;

function stateSummary(rows: Record_[]): Row[] {
  const states = [...new Set(rows.map((p) => p.state).filter(Boolean))].sort() as string[];
  const out: Row[] = [];
  for (const st of states) {
    const s = rows.filter((p) => p.state === st);
    const clean = s.filter((p) => ["READY_FOR_VERIFICATION", "VERIFIED"].includes(p.verificationStatus));
    out.push([
      st,
      clean.length,
      clean.filter((p) => p.emailVerificationStatus === "VALID").length,
      clean.filter((p) => ["CATCH_ALL", "RISKY", "UNKNOWN"].includes(p.emailVerificationStatus)).length,
      clean.filter((p) => p.emailVerificationStatus === "NOT_CHECKED" && p.email).length,
      clean.filter((p) => !p.email).length,
      clean.filter((p) => p.phone).length,
      s.filter((p) => p.verificationStatus === "NEEDS_REVIEW").length,
      s.filter((p) => p.verificationStatus === "EXCLUDED").length,
    ]);
  }
  return out;
}

function report(
  all: Record_[], scoped: Record_[], verified: Record_[], valid: Record_[],
  excluded: Record_[],
): FinalReport {
  const chainWords = ["chain", "hospital", "government", "ltc", "mail-order", "shared"];
  const isChain = (r: string | null) =>
    !!r && chainWords.some((w) => r.toLowerCase().includes(w));
  const isClosed = (r: string | null) => !!r && r.toLowerCase().includes("licence-closed");

  const caveats: string[] = [];
  const statesCovered = [...new Set(scoped.map((p) => p.state).filter(Boolean))].sort() as string[];

  if (statesCovered.length < 51)
    caveats.push(`Covers ${statesCovered.length} of the 51 jurisdictions requested. The remainder ` +
      `have not been acquired: most state boards do not publish email addresses at all, and several ` +
      `charge for their roster or forbid commercial reuse.`);
  const unverified = verified.filter((p) => p.email && p.emailVerificationStatus === "NOT_CHECKED").length;
  if (unverified)
    caveats.push(`${unverified.toLocaleString()} addresses have not been through a verification ` +
      `service yet, so they are reported as "Not yet verified" rather than counted as valid.`);
  const noWebsite = verified.filter((p) => !p.website).length;
  if (noWebsite)
    caveats.push(`${noWebsite.toLocaleString()} records have no website: no state board publishes ` +
      `one, so it can only come from discovery or a commercial file.`);
  const noOwner = verified.filter((p) => !p.ownerName && !p.picName && !p.buyerName).length;
  if (noOwner)
    caveats.push(`${noOwner.toLocaleString()} records name no owner or pharmacist-in-charge: only ` +
      `some boards publish one.`);

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    totalIndependentPharmacies: verified.length,
    totalValidEmails: valid.length,
    totalWithoutEmail: verified.filter((p) => !p.email).length,
    totalChainsRemoved: excluded.filter((p) => isChain(p.exclusionReason)).length,
    totalClosedRemoved: excluded.filter((p) => isClosed(p.exclusionReason)).length,
    totalDuplicatesRemoved: 0,   // set by the caller from import-batch accounting
    totalActiveLicensesVerified: verified.filter((p) => p.licenseStatus === "ACTIVE").length,
    statesCovered,
    emailsNotYetVerified: unverified,
    toolsUsed: [
      "State pharmacy board licence records (primary source)",
      "Automated normalisation and chain/institution screening",
      "Shared-contact analysis for ownership",
      "Email syntax and role-account classification",
    ],
    caveats,
  };
}
