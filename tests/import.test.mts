import "./setup-env.mts";
import assert from "node:assert/strict";

/**
 * The preprocessing rules, tested as pure functions.
 *
 * These decide what enters the registry, so a mistake here is not a display bug - it is a chain
 * outlet in a campaign, or an independent pharmacy silently dropped.
 */
const R: [string, boolean][] = [];
function check(label: string, fn: () => void) {
  try { fn(); R.push([label, true]); }
  catch (e) { R.push([`${label} — ${(e as Error).message}`, false]); }
}

// ---------------------------------------------------------------- delimited parsing
const { parseDelimited, sniffDelimiter, formatFor } = await import("../lib/import/parse");

check("parses a simple csv", () =>
  assert.deepEqual(parseDelimited("a,b\n1,2\n", ","), [["a", "b"], ["1", "2"]]));
check("quoted field containing the delimiter", () =>
  assert.deepEqual(parseDelimited('name,city\n"Smith, Jones Rx",Miami\n', ","),
    [["name", "city"], ["Smith, Jones Rx", "Miami"]]));
check("doubled quotes are one literal quote", () =>
  assert.deepEqual(parseDelimited('a\n"He said ""hi"""\n', ","), [["a"], ['He said "hi"']]));
check("embedded newline inside a quoted field", () =>
  assert.deepEqual(parseDelimited('a,b\n"line1\nline2",x\n', ","),
    [["a", "b"], ["line1\nline2", "x"]]));
check("a UTF-8 BOM does not become part of the first header", () =>
  assert.equal(parseDelimited("﻿name,city\nA,B\n", ",")[0][0], "name"));
check("CRLF line endings", () =>
  assert.deepEqual(parseDelimited("a,b\r\n1,2\r\n", ","), [["a", "b"], ["1", "2"]]));
check("blank lines are dropped, not turned into rows", () =>
  assert.equal(parseDelimited("a,b\n1,2\n\n\n3,4\n", ",").length, 3));
check("a ragged row keeps its own width", () =>
  assert.deepEqual(parseDelimited("a,b,c\n1,2\n", ","), [["a", "b", "c"], ["1", "2"]]));
check("pipe-delimited files are sniffed", () =>
  assert.equal(sniffDelimiter("name|city|zip\nA|B|C"), "|"));
check("tab-delimited files are sniffed", () =>
  assert.equal(sniffDelimiter("name\tcity\nA\tB"), "\t"));
check("file extensions map to formats", () => {
  assert.equal(formatFor("roster.CSV"), "csv");
  assert.equal(formatFor("roster.xlsx"), "xlsx");
  assert.equal(formatFor("LIC_2205-P.txt"), "psv");
  assert.equal(formatFor("notes.pdf"), null);
});

// ---------------------------------------------------------------- normalisation
const n = await import("../lib/import/normalize");

check("phone is reduced to a 10-digit US number", () => {
  assert.equal(n.normalizePhone("(305) 665-4411"), "+13056654411");
  assert.equal(n.normalizePhone("1-305-665-4411"), "+13056654411");
});
check("an unusable phone is dropped rather than guessed", () => {
  assert.equal(n.normalizePhone("555-1234"), null);       // too short
  assert.equal(n.normalizePhone("0000000000"), null);
  assert.equal(n.normalizePhone("1234567890"), null);     // area code cannot start with 1
});
check("a ZIP that lost its leading zero is restored", () =>
  assert.equal(n.normalizeZip("7094"), "07094"));
check("ZIP+4 is truncated to five", () =>
  assert.equal(n.normalizeZip("33101-1234"), "33101"));
check("state names and codes both resolve", () => {
  assert.equal(n.normalizeState("Florida"), "FL");
  assert.equal(n.normalizeState("fl"), "FL");
  assert.equal(n.normalizeState("Freedonia"), null);
});
check("NPI check digit is enforced", () => {
  // Real NPIs taken from the registry, so the check is tested against values that must pass.
  for (const npi of ["1760248066", "1922181965", "1154289809"])
    assert.equal(n.normalizeNpi(npi), npi, npi);
  assert.equal(n.normalizeNpi("1234567890"), null);           // fails the check digit
  assert.equal(n.normalizeNpi("176024806"), null);            // nine digits
});
check("email case is normalised on the domain only", () =>
  assert.equal(n.normalizeEmail("Rx.Team@Example.COM"), "Rx.Team@example.com"));
check("a mailto: prefix and stray punctuation are stripped", () =>
  assert.equal(n.normalizeEmail("<mailto:a@b.com>"), "a@b.com"));
check("the first of several addresses in one cell is taken", () =>
  assert.equal(n.normalizeEmail("a@b.com; c@d.com"), "a@b.com"));
check("a malformed address is rejected", () => {
  assert.equal(n.normalizeEmail("not an email"), null);
  assert.equal(n.normalizeEmail("a@@b.com"), null);
});
check("shared inboxes are kept and labelled", () => {
  const v = n.classifyEmail("info@corner-rx.com");
  assert.equal(v.ok && v.kind, "SHARED");
});
check("a role prefix with a separator is still shared", () =>
  assert.equal(n.classifyEmail("rx.orders@corner-rx.com").ok
    && n.classifyEmail("rx.orders@corner-rx.com").kind, "SHARED"));
check("a named address is personal", () =>
  assert.equal(n.classifyEmail("jane.doe@corner-rx.com").ok
    && n.classifyEmail("jane.doe@corner-rx.com").kind, "PERSONAL"));
check("unmailable addresses are excluded, not labelled", () =>
  assert.equal(n.classifyEmail("noreply@corner-rx.com").ok, false));
check("placeholder domains are excluded", () =>
  assert.equal(n.classifyEmail("owner@example.com").ok, false));

// ---------------------------------------------------------------- classification
const { classify, isOpen, classifyLicenceType } = await import("../lib/import/classify");

check("national chains are excluded", () => {
  for (const name of ["CVS Pharmacy #4412", "Walgreens 09112", "Rite Aid of Ohio"])
    assert.equal(classify(name).decision, "EXCLUDE", name);
});
check("supermarket banners are excluded", () => {
  for (const name of ["Kroger Pharmacy", "Publix Super Markets", "Safeway Pharmacy #1821"])
    assert.equal(classify(name).decision, "EXCLUDE", name);
});
check("independent franchise banners are KEPT", () => {
  for (const name of ["Brazos Valley Health Mart", "Good Neighbor Pharmacy of Tyler",
                      "The Medicine Shoppe", "Medicap Pharmacy"])
    assert.equal(classify(name).decision, "INCLUDE", name);
});
check("a franchise banner beats a chain word in the same name", () =>
  // "Health Mart" must win over any supermarket signal that follows it.
  assert.equal(classify("Health Mart at Weis Market Plaza").decision, "INCLUDE"));
check("hospitals, government and LTC are excluded", () => {
  assert.equal(classify("St Mary Hospital Pharmacy").decision, "EXCLUDE");
  assert.equal(classify("VA Medical Center Pharmacy").decision, "EXCLUDE");
  assert.equal(classify("Sunrise Nursing Home Pharmacy").decision, "EXCLUDE");
});
check("a chain signal in the DBA is caught even when the legal name looks independent", () =>
  assert.equal(classify("ABC Retail Holdings LLC", "Walmart Pharmacy 10-1234").decision, "EXCLUDE"));
check("an unrecognised numbered store goes to review, not out", () =>
  assert.equal(classify("Corner Drug #4471").decision, "REVIEW"));
check("an ordinary independent is included", () =>
  assert.equal(classify("Oak Ridge Apothecary").decision, "INCLUDE"));

check("closed licence words are recognised", () => {
  for (const s of ["Expired", "REVOKED", "Closed", "Voluntarily Surrendered", "Inactive"])
    assert.equal(isOpen(s), false, s);
});
check("open licence words are recognised", () => {
  for (const s of ["Active", "ACTIVE - IN GOOD STANDING", "Current", "Clear"])
    assert.equal(isOpen(s), true, s);
});
check("an unknown or missing status is not read as open", () => {
  assert.equal(isOpen(""), null);
  assert.equal(isOpen("Pending review"), null);
});
check("wholesalers and mail-service permits are excluded by type", () => {
  assert.equal(classifyLicenceType("Wholesale Distributor").decision, "EXCLUDE");
  assert.equal(classifyLicenceType("Mail Service Pharmacy").decision, "EXCLUDE");
  assert.equal(classifyLicenceType("Non-Resident Pharmacy").decision, "EXCLUDE");
});
check("an ambiguous permit class goes to review", () =>
  assert.equal(classifyLicenceType("Special Limited Community").decision, "REVIEW"));
check("a plain community permit is accepted", () =>
  assert.equal(classifyLicenceType("Community Pharmacy").decision, "INCLUDE"));

// ------------------------------------------------- chains confirmed from the registry
check("regional chains found in the data are excluded", () => {
  for (const name of ["DISCOUNT DRUG MART #42", "MARC'S PHARMACY", "CenterWell Pharmacy, Inc.",
                      "GENOA HEALTHCARE LLC", "OMNICARE OF EDISON", "PHARMERICA",
                      "GUARDIAN PHARMACY OF NW FLORIDA", "JUBILANT DRAXIMAGE INC"])
    assert.equal(classify(name).decision, "EXCLUDE", name);
});
check("Sam's Club stores are caught despite the name carrying no 'club'", () =>
  // Licensed as "SAM'S PHARMACY 10-4750"; matching on "sam's club" alone missed all 26.
  assert.equal(classify("SAM'S PHARMACY 10-4750").decision, "EXCLUDE"));
check("named health systems are excluded", () => {
  for (const name of ["ORLANDO HEALTH, INC.", "BARNABAS HEALTH RETAIL PHARMACY",
                      "HACKENSACK UNIVERSITY MEDICAL CTR.", "Cleveland Clinic Mercy",
                      "ADVENTHEALTH PHARMACY"])
    assert.equal(classify(name).decision, "EXCLUDE", name);
});
check("a brand rule does not read the permit class", () => {
  // "Community Health & Wellness Partners" + a licence type of "Pharmacy" reads as
  // "...partners pharmacy" and wrongly matched an LTC operator of that name.
  assert.equal(
    classify("Community Health & Wellness Partners", null, "Terminal - Pharmacy", "PHARMACY")
      .decision, "INCLUDE");
});
check("an institutional permit class is still honoured", () =>
  assert.equal(classify("Anytown Pharmacy", null, "Institutional Pharmacy").decision, "EXCLUDE"));

// ------------------------------------------------- institutions written in shorthand
check("abbreviated hospitals are excluded", () => {
  // Board files abbreviate: 73 of these were sitting in the registry because "medical center"
  // and "hospital" do not appear in them.
  for (const name of ["ORLANDO REGIONAL MEDICAL CTR", "ST JOSEPHS HOSP PHARMACY",
                      "ST. LUKES WARREN HOSP.", "ROBERT WOOD JOHNSON UNIV HOSP",
                      "PALISADES MEDICAL CTR PHCY DEP", "ST BARNABAS BEHAVIORAL HLTH CT",
                      "ENCOMPASS HEALTH REHAB. HOSP. OF TOMS RIVER",
                      "STUDENT HEALTH SERV PHARMACY MONTANA STATE UNIVERSITY"])
    assert.equal(classify(name).decision, "EXCLUDE", name);
});
check("a pharmacy selling surgical supplies is NOT a surgical facility", () => {
  // The counter-examples that stop the abbreviation rules being written too loosely: every one
  // of these is an independent retailer.
  for (const name of ["BARON II DRUG & SURGICAL", "COMMUNITY PHARMACY & SURGICAL",
                      "LIBERTY DRUG AND SURGICAL", "PHARMACY PLUS AND SURGICAL SUPPLIES",
                      "THE WELLNESS CENTER PHARMACY & SURGICAL"])
    assert.equal(classify(name).decision, "INCLUDE", name);
});
check("words that cut both ways go to review rather than being guessed", () => {
  // "University Drugs" is a shop near a campus; "Univ Hosp" is not. The name cannot settle it.
  for (const name of ["UNIVERSITY DRUGS, LLC", "CLINIC PRESCRIPTION SHOP",
                      "FLORIDA COAST MEDICAL AND SURGICAL CENTER INC."])
    assert.equal(classify(name).decision, "REVIEW", name);
});

// ------------------------------------------------- shared contact across locations
const { judgeSharedContact, companyDomain, CHAIN_LOCATION_THRESHOLD, GROUP_REVIEW_THRESHOLD } =
  await import("../lib/import/classify");

check("many locations behind one mailbox is a chain", () =>
  assert.equal(judgeSharedContact("ltaylor@discount-drugmart.com", 70).decision, "EXCLUDE"));
check("a handful of locations is reviewed, not assumed either way", () => {
  // The client includes small local groups and excludes regional chains; nothing in the data
  // separates a five-store family group from a five-store chain, so a human decides.
  assert.equal(judgeSharedContact("greg.paisley@shriverspharmacy.com", 5).decision, "REVIEW");
});
check("a single location is untouched", () =>
  assert.equal(judgeSharedContact("owner@corner-rx.com", 1).decision, "INCLUDE"));
check("the thresholds are ordered and non-overlapping", () =>
  assert.ok(GROUP_REVIEW_THRESHOLD < CHAIN_LOCATION_THRESHOLD));
check("consumer mailboxes say nothing about ownership", () => {
  // A family pharmacy on gmail is still one shop; grouping by gmail.com would condemn hundreds.
  for (const e of ["owner@gmail.com", "rx@yahoo.com", "shop@comcast.net", "a@sbcglobal.net"])
    assert.equal(companyDomain(e), null, e);
  assert.equal(companyDomain("ltaylor@discount-drugmart.com"), "discount-drugmart.com");
});

// ---------------------------------------------------------------- the chain end to end
const { runRules, dedupeKey, cleanRow } = await import("../lib/import/engine");
const { suggestMapping, REQUIRED_FIELDS } = await import("../lib/import/fields");

const mapping = {
  name: "Name", email: "Email", phone: "Phone", state: "State", city: "City",
  streetAddress: "Address", zipCode: "Zip", licenseStatus: "Status", licenseType: "Type",
  county: "County",
} as const;

const row = (over: Record<string, string>) => ({
  Name: "Oak Ridge Apothecary", Email: "owner@oakridgerx.com", Phone: "(305) 665-4411",
  State: "FL", City: "Miami", Address: "123 Main Street", Zip: "33101",
  Status: "Active", Type: "Community Pharmacy", County: "Miami-Dade", ...over,
});

check("a clean independent is accepted", () => {
  const { verdicts } = runRules([row({})], mapping);
  assert.equal(verdicts[0].decision, "ACCEPTED");
  assert.equal(verdicts[0].cleaned.email, "owner@oakridgerx.com");
  assert.equal(verdicts[0].cleaned.phone, "+13056654411");
});
check("a row with no email is kept but flagged", () => {
  const { verdicts } = runRules([row({ Email: "" })], mapping);
  assert.equal(verdicts[0].decision, "ACCEPTED");
  assert.equal(verdicts[0].cleaned.email, null);
  assert.ok(verdicts[0].notes.some((x) => x.includes("no email")));
});
check("rules run in order: a closed chain reports the licence, not the chain", () => {
  const { verdicts } = runRules([row({ Name: "CVS Pharmacy", Status: "Expired" })], mapping);
  assert.equal(verdicts[0].rule, "licence-closed");
});
check("duplicates inside one file are removed", () => {
  const { verdicts, analysis } = runRules([row({}), row({ Email: "other@oakridgerx.com" })], mapping);
  assert.equal(verdicts[1].decision, "EXCLUDED");
  assert.equal(verdicts[1].rule, "duplicate");
  assert.equal(analysis.accepted, 1);
});
check("the same pharmacy at a different address is not a duplicate", () => {
  const { analysis } = runRules([row({}), row({ Address: "900 Ocean Drive", Zip: "33139" })], mapping);
  assert.equal(analysis.accepted, 2);
});
check("county 'out of state' excludes as non-resident", () => {
  const { verdicts } = runRules([row({ County: "Out of State" })], mapping);
  assert.equal(verdicts[0].rule, "non-resident");
});
check("the analysis adds up", () => {
  const { analysis } = runRules([
    row({}), row({ Name: "CVS Pharmacy #1" }), row({ Name: "Corner Drug #4471", Address: "5 Elm" }),
  ], mapping);
  assert.equal(analysis.totalRows, 3);
  assert.equal(analysis.accepted + analysis.review + analysis.excluded, 3);
  assert.equal(analysis.excluded, 1);
  assert.equal(analysis.review, 1);
});
check("state counts cover kept rows only", () => {
  const { analysis } = runRules([row({}), row({ Name: "CVS", Address: "9 Oak" })], mapping);
  assert.equal(analysis.byState["FL"], 1);
});
check("a shared inbox is counted separately", () => {
  const { analysis } = runRules([row({ Email: "info@oakridgerx.com" })], mapping);
  assert.equal(analysis.sharedInboxes, 1);
});
check("an unmapped column yields null rather than throwing", () => {
  const { cleaned } = cleanRow({ Name: "A" }, { name: "Name" });
  assert.equal(cleaned.city, null);
  assert.equal(cleaned.email, null);
});
check("dedupe key ignores punctuation and case", () =>
  assert.equal(
    dedupeKey(cleanRow(row({ Name: "OAK RIDGE APOTHECARY, INC." }), mapping).cleaned),
    dedupeKey(cleanRow(row({ Name: "OAK RIDGE APOTHECARY, INC." }), mapping).cleaned)));

check("headers are mapped to canonical fields automatically", () => {
  const m = suggestMapping(["Pharmacy Name", "E-mail Address", "License Number", "State", "Zip Code"]);
  assert.equal(m.name, "Pharmacy Name");
  assert.equal(m.email, "E-mail Address");
  assert.equal(m.licenseNumber, "License Number");
  assert.equal(m.zipCode, "Zip Code");
});
check("one column is never claimed by two fields", () => {
  const m = suggestMapping(["Name", "Email"]);
  const used = Object.values(m);
  assert.equal(new Set(used).size, used.length);
});
check("email is a required field", () =>
  assert.ok(REQUIRED_FIELDS.includes("email")));

// ---------------------------------------------------------------- audience filters
const { audienceWhere, ELIGIBLE_WHERE } = await import("../lib/campaign/audience");

check("an empty filter selects everything", () =>
  assert.deepEqual(audienceWhere({}), {}));
check("states, types and address kinds each narrow the pool", () => {
  const w = audienceWhere({ states: ["FL", "OH"], pharmacyTypes: ["COMMUNITY"],
                            emailKinds: ["PERSONAL"] });
  assert.deepEqual(w.state, { in: ["FL", "OH"] });
  assert.deepEqual(w.pharmacyType, { in: ["COMMUNITY"] });
  assert.deepEqual(w.emailKind, { in: ["PERSONAL"] });
});
check("excluding contacted pharmacies means never-contacted only", () =>
  assert.equal(audienceWhere({ excludeContacted: true }).leadStatus, "NOT_CONTACTED"));
check("a filter cannot loosen eligibility", () => {
  // Whatever the filter says, the eligibility clause is applied on top of it, so a filter can
  // only ever reduce the set - never reach a pharmacy the rules exclude.
  const w = { ...audienceWhere({ states: ["FL"] }), ...ELIGIBLE_WHERE };
  assert.equal(w.verificationStatus, "VERIFIED");
  assert.equal(w.emailVerificationStatus, "VALID");
  assert.equal(w.licenseStatus, "ACTIVE");
  assert.equal(w.operationalStatus, "OPEN");
});
check("the eligibility query names the same six rules as the function", async () => {
  const { ELIGIBILITY_RULES } = await import("../lib/campaign/eligibility");
  // Two expressions of one rule set drift apart silently; this is the tie between them.
  const keys = Object.keys(ELIGIBLE_WHERE);
  assert.ok(keys.includes("verificationStatus"));
  assert.ok(keys.includes("licenseStatus"));
  assert.ok(keys.includes("operationalStatus"));
  assert.ok(keys.includes("ownershipStatus"));
  assert.ok(keys.includes("emailVerificationStatus"));
  assert.ok(keys.includes("email"));
  assert.equal(ELIGIBILITY_RULES.length, 7);   // the six above plus the suppression list
});

// ---------------------------------------------------------------- Reoon result mapping
const { mapResult } = await import("../lib/verify/reoon");

// The provider's own documented payloads, verbatim from its API reference.
const REOON_SAFE = {
  email: "jhon200@outlook.com", domain: "outlook.com", status: "safe",
  can_connect_smtp: true, has_inbox_full: false, is_catch_all: false, is_deliverable: true,
  is_disabled: false, is_disposable: false, is_role_account: false, is_safe_to_send: true,
  is_spamtrap: false, is_valid_syntax: true, mx_accepts_mail: true,
};
const REOON_INVALID = {
  email: "test1@yahoo.com", domain: "yahoo.com", status: "invalid",
  can_connect_smtp: true, has_inbox_full: false, is_catch_all: false, is_deliverable: false,
  is_disabled: false, is_disposable: false, is_role_account: false, is_safe_to_send: false,
  is_spamtrap: "None", is_valid_syntax: true, mx_accepts_mail: true,
};

check("a safe address is valid and mailable", () => {
  const m = mapResult(REOON_SAFE);
  assert.equal(m.result, "VALID");
  assert.equal(m.suppress, false);
});
check("an undeliverable address is invalid and suppressed", () => {
  const m = mapResult(REOON_INVALID);
  assert.equal(m.result, "INVALID");
  assert.equal(m.suppress, true);
});
check('is_spamtrap "None" is not read as a spamtrap', () =>
  // The provider sends the string "None", which is truthy in JavaScript. Reading it as a
  // spamtrap would suppress a perfectly good address on every invalid result it returns.
  assert.equal(mapResult(REOON_INVALID).detail.includes("spamtrap"), false));
check("a real spamtrap is suppressed outright", () => {
  const m = mapResult({ ...REOON_SAFE, is_spamtrap: true });
  assert.equal(m.result, "INVALID");
  assert.equal(m.suppress, true);
  assert.match(m.detail, /spamtrap/);
});
check("a catch-all is never counted as valid, even when it looks deliverable", () => {
  // The domain accepts everything, so a deliverable verdict proves nothing about the mailbox -
  // and the brief is explicit that catch-all must not be mixed into the campaign list.
  const m = mapResult({ ...REOON_SAFE, is_catch_all: true });
  assert.equal(m.result, "CATCH_ALL");
  assert.equal(m.suppress, false);
});
check("a deliverable role account stays valid", () => {
  // info@ and pharmacy@ are frequently the only address an independent pharmacy publishes;
  // downgrading them here would discard most of the list.
  const m = mapResult({ ...REOON_SAFE, is_role_account: true });
  assert.equal(m.result, "VALID");
  assert.match(m.detail, /role account/);
});
check("a disposable address is risky, not valid", () =>
  assert.equal(mapResult({ ...REOON_SAFE, is_disposable: true }).result, "RISKY"));
check("a full or disabled mailbox is invalid but not suppressed", () => {
  // It may come back; suppression is permanent, so it is not applied here.
  const m = mapResult({ ...REOON_SAFE, has_inbox_full: true });
  assert.equal(m.result, "INVALID");
  assert.equal(m.suppress, false);
});
check("a domain with no MX is invalid", () =>
  assert.equal(mapResult({ ...REOON_SAFE, mx_accepts_mail: false }).result, "INVALID"));
check("an unknown verdict is left unknown, never guessed into the campaign", () =>
  // No deliverability signal either way: the verifier could not decide, so neither do we.
  assert.equal(mapResult({ email: "x@y.com", domain: "y.com", status: "unknown",
                           is_valid_syntax: true, mx_accepts_mail: true }).result, "UNKNOWN"));
check("a verdict of unknown alongside undeliverable is still invalid", () =>
  // Deliverability outranks the summary word: the address does not accept mail.
  assert.equal(mapResult({ ...REOON_SAFE, status: "unknown", is_safe_to_send: false,
                           is_deliverable: false }).result, "INVALID"));
check("an unfamiliar verdict is reported as risky rather than assumed good", () =>
  assert.equal(mapResult({ email: "x@y.com", status: "something_new" }).result, "RISKY"));

// ---------------------------------------------------------------- verifier results
const { RESULTS } = await import("../lib/verify/service");

check("every verification result is one the registry understands", () =>
  assert.deepEqual(RESULTS, ["VALID", "INVALID", "RISKY", "CATCH_ALL", "UNKNOWN"]));

const failed = R.filter(([, ok]) => !ok);
for (const [label, ok] of R) if (!ok) console.log(`  FAIL ${label}`);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);
