/**
 * Field normalisation. Ported from phase2/normalize.py so the CRM owns the rules rather than
 * shelling out to the acquisition pipeline - an upload has to be cleaned the same way the
 * existing 3,801 records were, or the registry stops being one dataset.
 *
 * Everything here is syntactic. None of it says a value is correct, only that it is well formed.
 */

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();

export function normalizeName(value: string | null): string | null {
  if (!value) return null;
  const s = collapse(String(value)).replace(/[，]/g, ",");
  return s || null;
}

/** Comparison form: case, punctuation and common suffixes removed. Never stored as the name. */
export function matchName(value: string | null): string | null {
  if (!value) return null;
  let s = String(value).toLowerCase();
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\b(inc|llc|l l c|ltd|corp|corporation|co|company|pa|pc|pllc|lp|llp)\b/g, " ");
  s = s.replace(/\b(the)\b/g, " ");
  return collapse(s) || null;
}

export function normalizeLicenseNumber(value: string | null): string | null {
  if (!value) return null;
  const s = String(value).toUpperCase().replace(/[\s.\-/]/g, "");
  return s || null;
}

/** North American 10-digit form. A number that is not 10 digits is not guessed at. */
export function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(digits)) return null;              // 0000000000 and friends
  if (digits.startsWith("0") || digits.startsWith("1")) return null;  // invalid area code
  return `+1${digits}`;
}

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;

/** Syntax normalisation only. Says nothing whatsoever about deliverability. */
export function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  let s = String(value).replace(/\s+/g, "").trim().replace(/^[.,;:<>()[\]"']+|[.,;:<>()[\]"']+$/g, "");
  if (s.toLowerCase().startsWith("mailto:")) s = s.slice(7);
  // Some boards pack several addresses into one cell; the first is the primary.
  const first = s.split(/[;,]/)[0]?.trim() ?? "";
  if (!first || (first.match(/@/g) ?? []).length !== 1) return null;
  const [local, domain] = first.split("@");
  const out = `${local}@${domain.toLowerCase()}`;
  return EMAIL_RE.test(out) ? out : null;
}

/**
 * Addresses that reach a function rather than a person. Kept - for an independent pharmacy this
 * is frequently the only address published, and often the owner reads it - but labelled, so a
 * campaign can choose.
 */
const ROLE_LOCALS = new Set([
  "info", "information", "contact", "contactus", "admin", "administrator", "office", "mail",
  "email", "main", "general", "enquiries", "inquiries", "hello", "help", "support", "service",
  "customerservice", "sales", "orders", "order", "billing", "accounts", "accounting", "ap", "ar",
  "hr", "careers", "jobs", "team", "staff", "store", "shop", "front", "frontdesk", "reception",
  "pharmacy", "pharmacist", "rx", "rxdept", "prescriptions", "refills", "clinic", "webmaster",
  "postmaster", "marketing", "manager",
]);

/** Addresses no human reads. Excluded outright rather than labelled - mail to them goes nowhere. */
const UNMAILABLE_LOCALS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "bounce", "bounces", "mailer-daemon",
  "abuse", "spam", "null", "none", "na", "test", "example", "unknown",
]);

const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "test.com", "email.com", "none.com",
  "noemail.com", "no-email.com", "nomail.com", "domain.com", "yourdomain.com",
]);

export type EmailKind = "PERSONAL" | "SHARED" | "UNKNOWN";
export type EmailVerdict =
  | { ok: true; email: string; kind: EmailKind }
  | { ok: false; reason: string };

export function classifyEmail(raw: string | null): EmailVerdict {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, reason: raw ? "email is not a valid address" : "no email address" };

  const [local, domain] = email.split("@");
  const bare = local.toLowerCase().replace(/[._-]/g, "");

  if (UNMAILABLE_LOCALS.has(local.toLowerCase()) || UNMAILABLE_LOCALS.has(bare))
    return { ok: false, reason: `unmailable address (${local}@)` };
  if (PLACEHOLDER_DOMAINS.has(domain))
    return { ok: false, reason: `placeholder domain (${domain})` };

  // A role prefix with a separator - rx.orders@, info-desk@ - counts as shared too.
  const head = local.toLowerCase().split(/[._-]/)[0] ?? "";
  const shared = ROLE_LOCALS.has(local.toLowerCase()) || ROLE_LOCALS.has(bare) || ROLE_LOCALS.has(head);
  return { ok: true, email, kind: shared ? "SHARED" : "PERSONAL" };
}

export function normalizeWebsite(value: string | null): string | null {
  if (!value) return null;
  let s = collapse(String(value)).toLowerCase();
  if (!s || s === "n/a" || s === "none") return null;
  if (!/^https?:\/\//.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    return `${u.protocol}//${u.hostname.replace(/^www\./, "")}`;
  } catch { return null; }
}

const STREET_ABBREV: Record<string, string> = {
  street: "St", str: "St", st: "St", avenue: "Ave", ave: "Ave", av: "Ave",
  boulevard: "Blvd", blvd: "Blvd", road: "Rd", rd: "Rd", drive: "Dr", dr: "Dr",
  lane: "Ln", ln: "Ln", court: "Ct", ct: "Ct", place: "Pl", pl: "Pl",
  highway: "Hwy", hwy: "Hwy", parkway: "Pkwy", pkwy: "Pkwy", suite: "Ste", ste: "Ste",
  north: "N", south: "S", east: "E", west: "W",
  northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW",
};

export function normalizeStreet(value: string | null): string | null {
  if (!value) return null;
  const s = collapse(String(value));
  if (!s) return null;
  return s.split(" ").map((word) => {
    const key = word.toLowerCase().replace(/[.,]/g, "");
    const abbrev = STREET_ABBREV[key];
    if (abbrev) return abbrev;
    if (/^\d/.test(word)) return word;                       // house numbers, 3rd, 42nd
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}

export function normalizeCity(value: string | null): string | null {
  if (!value) return null;
  const s = collapse(String(value).replace(/[.,]+$/, ""));
  if (!s) return null;
  return s.split(" ").map((w) =>
    w.length <= 2 && w === w.toUpperCase() ? w
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATE_NAMES));

export function normalizeState(value: string | null): string | null {
  if (!value) return null;
  const s = collapse(String(value)).toLowerCase();
  if (!s) return null;
  const code = s.toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length === 2 && STATE_CODES.has(code)) return code;
  return STATE_NAMES[s] ?? null;
}

/** Five digits. ZIP+4 is truncated: the extra four are not reliable across sources. */
export function normalizeZip(value: string | null): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length >= 5) {
    const five = digits.slice(0, 5);
    return five === "00000" ? null : five;
  }
  // Leading zeros are routinely eaten by spreadsheets - 07094 arrives as 7094.
  return digits.length >= 3 ? digits.padStart(5, "0") : null;
}

/** Ten digits, validated with the Luhn check NPIs carry. */
export function normalizeNpi(value: string | null): string | null {
  if (!value) return null;
  const d = String(value).replace(/\D/g, "");
  if (d.length !== 10) return null;

  // NPI prefixes the number with 80840 before the Luhn check.
  const payload = `80840${d.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    let n = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[9]) ? d : null;
}

export function normalizeNcpdp(value: string | null): string | null {
  if (!value) return null;
  const d = String(value).replace(/\D/g, "");
  return d.length === 7 ? d : null;
}
