/**
 * Chain, institution and long-term-care classification. Ported from pipeline/classify.py.
 *
 * Accuracy over volume: anything ambiguous becomes REVIEW rather than being guessed into the
 * registry or out of it. The customer is an independently owned pharmacy that can choose its own
 * wholesaler — a chain outlet cannot, so including one is not a near miss, it is a wrong record.
 */

/** National chains and the banners they operate under. */
const NATIONAL: Record<string, string> = {
  "cvs": "CVS", "walgreen": "Walgreens", "duane reade": "Walgreens (Duane Reade)",
  "wal-mart": "Walmart", "walmart": "Walmart", "sam's club": "Sam's Club", "sams club": "Sam's Club",
  "publix": "Publix", "costco": "Costco", "rite aid": "Rite Aid", "riteaid": "Rite Aid",
  // Sam's Club stores are licensed as "SAM'S PHARMACY 10-4750" - no "club" anywhere in the name.
  "sam's pharmacy": "Sam's Club", "sams pharmacy": "Sam's Club",
  "amazon": "Amazon Pharmacy", "pillpack": "Amazon (PillPack)",
  "target store": "Target (CVS-operated)",
};

const KROGER = ["kroger", "fred meyer", "ralphs", "king soopers", "smith's food", "smiths food",
  "fry's food", "frys food", "qfc", "quality food centers", "dillons", "harris teeter",
  "pick 'n save", "pick n save", "mariano's", "marianos", "baker's", "jay c",
  "metro market", "city market", "gerbes", "ruler foods"];

const ALBERTSONS = ["albertson", "safeway", "vons", "jewel-osco", "jewel osco", "osco ",
  "osco pharmacy", "acme markets", "acme pharmacy", "acme dept", "shaw's", "shaws ",
  "star market", "tom thumb", "randalls", "carrs ", "haggen", "united supermarkets",
  "pavilions", "market street pharmacy", "united pharmacy"];

/**
 * Regional chains, PBM-owned and institutional operators found in the registry itself rather than
 * assumed. Each was confirmed from the contact domain attached to its records - a brand operating
 * dozens of locations behind one licensing mailbox is not an independent buyer.
 */
const CONFIRMED_OPERATORS = [
  "discount drug mart",        // ~70 Ohio stores, ltaylor@discount-drugmart.com
  "marc's", "marcs ",          // Ohio discount chain, eleneghan@marcs.com
  "omnicare",                  // CVS Health - permitinfo@cvshealth.com
  "pharmerica", "pharmacy corporation of america",   // LTC, compliance@pharmerica.com
  "centerwell",                // Humana
  "genoa healthcare",          // Optum / UnitedHealth
  "cps solutions",             // Optum
  "partners pharmacy",         // LTC
  "guardian pharmacy",         // LTC
  "vital care",                // infusion
  "option care", "bioscrip",   // infusion
  "jubilant", "draximage", "curium", "lantheus",     // radiopharmaceutical manufacturers
  "cardinal health", "mckesson", "amerisourcebergen", "cencora",
];

const OTHER_CHAIN = ["meijer", "h-e-b", "heb pharmacy", "hy-vee", "hyvee", "giant eagle",
  "wegmans", "winn-dixie", "food lion", "stop & shop", "stop and shop", "giant food",
  "weis market", "price chopper", "shoprite", "shop rite", "shop-rite", "hannaford", "ahold",
  "harveys", "brookshire", "raley's", "save mart", "lucky supermarket", "sprouts",
  "whole foods", "bi-lo", "ingles market", "piggly wiggly", "schnucks", "wakefern",
  "tops market", "rouses", "walgreen co", "express scripts", "optum", "cigna", "caremark",
  "humana pharmacy", "accredo", "briova"];

/**
 * Franchise banners whose members are independently owned. These must never be excluded - they
 * are precisely the target customer, and the banner name is the thing that would otherwise trip
 * the chain rules.
 */
const INDEPENDENT_FRANCHISE = ["health mart", "good neighbor pharmacy", "medicine shoppe", "medicap"];

const HOSPITAL = ["hospital", "medical center", "health system", "healthcare system", "med center",
  "regional health", "memorial health", "clinic pharmacy", "health center", "medical group",
  "cancer center", "surgery center", "infirmary", "sanatorium", "children's health",
  "university of", "college of medicine",
  // Named systems seen in the registry, each confirmed from its own contact domain.
  "orlando health", "adventhealth", "advent health", "hca health", "healthtrust",
  "rwjbarnabas", "barnabas health", "hackensack", "atlanticare", "baptist health",
  "ascension", "trinity health", "providence health", "bon secours", "novant",
  "atrium health", "wellstar", "ochsner", "sentara", "inova", "geisinger",
  "cleveland clinic", "mayo clinic", "kaiser", "sutter health", "mercy health",
  "billings clinic", "st barnabas", "st. barnabas", "virtua ", "encompass health",
  "shands ", "robert wood johnson",
  "summa health", "premier health", "university hospitals", "equitas health",
  // Federally qualified health centres and their usual phrasing.
  "community health center", "community health centers", "federally qualified",
  "rural health care", "health alliance", "health care district", "primary care center"];

const GOVERNMENT = ["dod ", "department of defense", "veterans", " va ", "va medical", "army",
  "navy", "air force", "usaf", "marine corps", "coast guard", "malmstrom", "indian health",
  "ihs ", "tribal", "correctional", "county jail", "prison", "state hospital", "public health",
  "department of health", "federal "];

const LTC = ["long term care", "long-term care", "ltc ", "nursing home", "nursing facility",
  "assisted living", "hospice", "skilled nursing", "senior care", "institutional pharmacy"];

const MAIL_ORDER = ["mail order", "mail-order", "mailorder", "home delivery"];

/**
 * Institutions written in shorthand.
 *
 * Board files abbreviate heavily - "ORLANDO REGIONAL MEDICAL CTR", "ST JOSEPHS HOSP PHARMACY",
 * "ST BARNABAS BEHAVIORAL HLTH CT". Substring matching on "medical center" and "hospital" misses
 * every one of them, and 73 were sitting in the registry because of it.
 */
const INSTITUTION_PATTERNS: [RegExp, string][] = [
  [/\bhosp\b|\bhosp\./i, "hospital (abbreviated)"],
  [/\bmed(ical)?\s*ctr\b/i, "medical centre (abbreviated)"],
  [/\bbehaviou?ral\s+(health|hlth)\b/i, "behavioural health facility"],
  [/\bstudent\s+health\b/i, "university student health service"],
  [/\b(health|hlth)\s+serv(ice)?s?\s+of\b/i, "public health service"],
  [/\brehab(ilitation)?\.?\s+(hosp|center|centre)\b/i, "rehabilitation facility"],
];

/**
 * Words that are institutional in one name and ordinary retail in another.
 *
 * "University Drugs" is a pharmacy near a campus; "Robert Wood Johnson Univ Hosp" is not. Neither
 * can be settled from the name alone, so these go to review rather than being guessed either way -
 * which is what the brief asks for when ownership is uncertain.
 */
const AMBIGUOUS_INSTITUTION: [RegExp, string][] = [
  [/\bclinic\b/i, "\"clinic\" can be a health system or an ordinary pharmacy"],
  [/\buniv(ersity)?\b/i, "\"university\" can be a teaching hospital or a pharmacy near a campus"],
  [/\bmedical\s+and\s+surgical\s+cent(er|re)\b/i, "could be a facility or a supply retailer"],
];

export type Decision = "INCLUDE" | "EXCLUDE" | "REVIEW";
export type ClassifyResult = { decision: Decision; reason: string; rule: string };

const hit = (text: string, needles: string[]) => needles.find((n) => text.includes(n)) ?? null;

export function classify(
  name: string | null, dba?: string | null, licenseType?: string | null, extra?: string | null,
): ClassifyResult {
  const flatten = (parts: (string | null | undefined)[]) =>
    ` ${parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase()} `;

  /*
   * Brands are matched against the brand fields only.
   *
   * Folding the permit class into the same string produced false positives: an FQHC called
   * "Community Health & Wellness Partners" with a licence type of "Pharmacy" reads as
   * "...partners pharmacy" and matched an LTC operator by that name. A permit class is not a
   * brand, so it does not get to answer a question about brands.
   */
  const brand = flatten([name, dba]);
  // Institution signals are real in either field: "Institutional Pharmacy" is a licence class.
  const text = flatten([name, dba, licenseType, extra]);

  // Independent franchise banners win over everything below them.
  const franchise = hit(brand, INDEPENDENT_FRANCHISE);
  if (franchise)
    return { decision: "INCLUDE", rule: "independent franchise",
             reason: `independent franchise banner: ${franchise}` };

  const operator = hit(brand, CONFIRMED_OPERATORS);
  if (operator)
    return { decision: "EXCLUDE", rule: "chain",
             reason: `chain or institutional operator: matched "${operator.trim()}"` };

  for (const [label, group] of [["Kroger-owned", KROGER], ["Albertsons-owned", ALBERTSONS],
                                ["large chain", OTHER_CHAIN]] as const) {
    const h = hit(brand, group);
    if (h) return { decision: "EXCLUDE", rule: "chain", reason: `${label}: matched "${h.trim()}"` };
  }
  for (const [needle, label] of Object.entries(NATIONAL)) {
    if (brand.includes(needle))
      return { decision: "EXCLUDE", rule: "chain", reason: `national chain: ${label}` };
  }

  const gov = hit(text, GOVERNMENT);
  if (gov) return { decision: "EXCLUDE", rule: "government",
                    reason: `government or military: matched "${gov.trim()}"` };

  const hosp = hit(text, HOSPITAL);
  if (hosp) return { decision: "EXCLUDE", rule: "hospital",
                     reason: `hospital or health system: matched "${hosp}"` };

  const ltc = hit(text, LTC);
  if (ltc) return { decision: "EXCLUDE", rule: "ltc",
                    reason: `long-term care: matched "${ltc.trim()}"` };

  const mail = hit(text, MAIL_ORDER);
  if (mail) return { decision: "EXCLUDE", rule: "mail-order",
                     reason: `mail order: matched "${mail.trim()}"` };

  // Abbreviated institutions, which the word lists above cannot see.
  for (const [pattern, label] of INSTITUTION_PATTERNS) {
    if (pattern.test(brand))
      return { decision: "EXCLUDE", rule: "hospital", reason: label };
  }

  // A supermarket "pharmacy department" is a chain outlet by definition: the store is the brand,
  // and the counter inside it is not an independent buyer.
  if (/\bdept\.?\s*\d{3,}/.test(brand) || brand.includes(" pharmacy dept"))
    return { decision: "REVIEW", rule: "store-department",
             reason: "supermarket pharmacy-department pattern; likely a chain outlet" };

  // A numbered store name is a strong chain signal even when the brand is unfamiliar.
  if (/#\s*\d{2,}/.test(brand))
    return { decision: "REVIEW", rule: "store-number",
             reason: "store-number pattern suggests a chain outlet; brand not recognised" };

  // Words that read institutional in one name and retail in another.
  for (const [pattern, why] of AMBIGUOUS_INSTITUTION) {
    if (pattern.test(brand))
      return { decision: "REVIEW", rule: "ambiguous-institution", reason: why };
  }

  return { decision: "INCLUDE", rule: "none", reason: "no chain, institution or LTC signal found" };
}

/* ------------------------------------------------------------------ licence status */

const CLOSED_WORDS = ["closed", "expired", "revoked", "suspended", "surrendered", "cancelled",
  "canceled", "inactive", "void", "terminated", "delinquent", "denied", "withdrawn", "lapsed",
  "retired", "deceased", "null and void", "not renewed"];

/** true = open, false = not open, null = the source did not say. */
export function isOpen(status: string | null): boolean | null {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return null;
  if (CLOSED_WORDS.some((w) => s.includes(w))) return false;
  if (s.startsWith("active") || ["clear", "current", "a", "valid", "open", "good standing",
      "in good standing", "licensed", "registered"].includes(s)) return true;
  return null;   // an unrecognised word is not read as open
}

/* ------------------------------------------------------------------ licence type */

/** Licence classes that are never an independent retail pharmacy, whatever the name says. */
const TYPE_EXCLUDE = ["wholesale", "distributor", "manufacturer", "repackager", "outsourcing",
  "third party logistics", "3pl", "reverse distributor", "broker", "veterinary", "animal",
  "research", "teaching", "charitable", "free clinic", "nuclear", "radiopharmac",
  "institutional", "hospital", "nursing", "correctional", "government", "military",
  "mail service", "mail order", "central fill", "shared services", "automated dispensing",
  "durable medical", "medical gas", "oxygen", "device", "cosmetic", "food"];

/** Classes that need a human eye rather than a guess. */
const TYPE_REVIEW = ["limited", "special", "restricted", "other", "miscellaneous", "temporary",
  "provisional", "pending", "clinic", "physician", "dispensing practitioner"];

export function classifyLicenceType(licenseType: string | null): ClassifyResult {
  const s = (licenseType ?? "").trim().toLowerCase();
  if (!s) return { decision: "INCLUDE", rule: "none", reason: "no licence type stated" };

  // Non-resident permits: licensed into a state from outside it. Not a local business.
  if (s.includes("non-resident") || s.includes("nonresident") || s.includes("non resident"))
    return { decision: "EXCLUDE", rule: "non-resident",
             reason: `non-resident permit: "${licenseType}"` };

  const ex = hit(` ${s} `, TYPE_EXCLUDE);
  if (ex) return { decision: "EXCLUDE", rule: "licence-type",
                   reason: `licence type "${licenseType}" matched "${ex.trim()}"` };

  const rev = hit(` ${s} `, TYPE_REVIEW);
  if (rev) return { decision: "REVIEW", rule: "licence-type",
                    reason: `licence type "${licenseType}" is ambiguous ("${rev.trim()}")` };

  return { decision: "INCLUDE", rule: "none", reason: `licence type "${licenseType}" accepted` };
}

/* ------------------------------------------------ shared contact across locations */

/**
 * The strongest chain signal this data actually carries.
 *
 * A brand operating from many addresses behind a single licensing mailbox is not an independent
 * buyer, whatever the name on the door says - Discount Drug Mart's seventy Ohio stores all list
 * one address, as do Sam's Club's twenty-three.
 *
 * The threshold is deliberately split, because the client includes "small locally owned pharmacy
 * groups" and excludes "large regional chains", and nothing in the data distinguishes a ten-store
 * family group from a ten-store regional chain. Above the upper bound it is a chain; between the
 * two a human decides.
 */
export const CHAIN_LOCATION_THRESHOLD = 12;
export const GROUP_REVIEW_THRESHOLD = 4;

export type SharedContactVerdict =
  | { decision: "EXCLUDE"; reason: string }
  | { decision: "REVIEW"; reason: string }
  | { decision: "INCLUDE"; reason: string };

/** Consumer mailboxes say nothing about ownership - a family pharmacy on gmail is still one shop. */
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "protonmail.com",
  "proton.me", "mail.com", "gmx.com", "zoho.com",
  // US ISP mailboxes, just as common on an independent pharmacy's board record.
  "comcast.net", "att.net", "sbcglobal.net", "bellsouth.net", "verizon.net", "cox.net",
  "charter.net", "earthlink.net", "roadrunner.com", "rr.com", "windstream.net", "frontier.com",
  "optonline.net", "juno.com", "netzero.net", "embarqmail.com", "centurylink.net",
]);

export function judgeSharedContact(
  label: string, distinctLocations: number,
): SharedContactVerdict {
  if (distinctLocations >= CHAIN_LOCATION_THRESHOLD)
    return { decision: "EXCLUDE",
             reason: `${distinctLocations} locations share the contact ${label} - a chain, not an independent` };
  if (distinctLocations >= GROUP_REVIEW_THRESHOLD)
    return { decision: "REVIEW",
             reason: `${distinctLocations} locations share the contact ${label} - confirm whether this is a small local group or a regional chain` };
  return { decision: "INCLUDE", reason: "contact is not shared across locations" };
}

/** The company part of an address, or null when it is a consumer mailbox. */
export function companyDomain(email: string | null): string | null {
  if (!email) return null;
  const domain = email.toLowerCase().split("@")[1];
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}
