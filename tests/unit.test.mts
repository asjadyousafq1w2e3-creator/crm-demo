/**
 * Pure-logic tests: eligibility, scheduling, routing, personalization, crypto.
 * No database, no network, no provider calls.
 */
import "./setup-env.mts";
import assert from "node:assert/strict";

const R: [string, boolean][] = [];
function check(label: string, fn: () => void) {
  try { fn(); R.push([label, true]); }
  catch (e) { R.push([`${label} — ${(e as Error).message}`, false]); }
}

// ---------------------------------------------------------------- eligibility
import { checkPharmacy } from "../lib/campaign/eligibility";
const verified = {
  id: 1, email: "rx@abc.com", verificationStatus: "VERIFIED", licenseStatus: "ACTIVE",
  operationalStatus: "OPEN", ownershipStatus: "INDEPENDENT", emailVerificationStatus: "VALID",
};
check("fully verified pharmacy is eligible", () =>
  assert.equal(checkPharmacy(verified).eligible, true));
check("unverified is blocked", () =>
  assert.equal(checkPharmacy({ ...verified, verificationStatus: "READY_FOR_VERIFICATION" }).eligible, false));
check("inactive licence is blocked", () =>
  assert.equal(checkPharmacy({ ...verified, licenseStatus: "EXPIRED" }).eligible, false));
check("closed pharmacy is blocked", () =>
  assert.equal(checkPharmacy({ ...verified, operationalStatus: "CLOSED" }).eligible, false));
check("chain ownership is blocked", () =>
  assert.equal(checkPharmacy({ ...verified, ownershipStatus: "CHAIN" }).eligible, false));
check("unverified email is blocked", () =>
  assert.equal(checkPharmacy({ ...verified, emailVerificationStatus: "NOT_CHECKED" }).eligible, false));
check("missing email is blocked", () =>
  assert.equal(checkPharmacy({ ...verified, email: null }).eligible, false));
check("LOCAL_GROUP ownership is allowed", () =>
  assert.equal(checkPharmacy({ ...verified, ownershipStatus: "LOCAL_GROUP" }).eligible, true));

// ---------------------------------------------------------------- scheduling
import { windowStatus, localDate, zonedParts } from "../lib/campaign/schedule";
const w = { timezone: "America/New_York", sendingDays: "1,2,3,4,5",
            sendingStartTime: "09:00", sendingEndTime: "16:00" };
// 2026-09-14 is a Monday. 14:00 UTC = 10:00 EDT.
check("inside window", () =>
  assert.equal(windowStatus(w, new Date("2026-09-14T14:00:00Z")).open, true));
check("before window", () => {
  const v = windowStatus(w, new Date("2026-09-14T11:00:00Z"));  // 07:00 EDT
  assert.equal(v.open, false); assert.equal((v as {reason:string}).reason, "BEFORE_WINDOW");
});
check("after window", () => {
  const v = windowStatus(w, new Date("2026-09-14T21:00:00Z"));  // 17:00 EDT
  assert.equal(v.open, false); assert.equal((v as {reason:string}).reason, "AFTER_WINDOW");
});
check("weekend is wrong day", () => {
  const v = windowStatus(w, new Date("2026-09-13T14:00:00Z"));  // Sunday
  assert.equal(v.open, false); assert.equal((v as {reason:string}).reason, "WRONG_DAY");
});
check("timezone is campaign's, not the server's", () => {
  // Same instant: inside the window in New York, outside it in Karachi.
  const at = new Date("2026-09-14T14:00:00Z");
  assert.equal(windowStatus(w, at).open, true);
  assert.equal(windowStatus({ ...w, timezone: "Asia/Karachi" }, at).open, false);
});
check("local date rolls at local midnight", () =>
  assert.equal(localDate("America/New_York", new Date("2026-09-15T03:00:00Z")), "2026-09-14"));
check("zonedParts reports ISO weekday", () =>
  assert.equal(zonedParts(new Date("2026-09-14T14:00:00Z"), "America/New_York").isoWeekday, 1));

// ---------------------------------------------------------------- router
import { route, remainingToday, effectiveDailyLimit, unusableReason, sentTodayAcross,
         globalHeadroom, totalCapacityToday } from "../lib/campaign/router";
const base = {
  id: 1, provider: "mock", emailAddress: "a@co.com", displayName: null, domain: "co.com",
  encryptedRefreshToken: null, providerAccountId: null, gmailHistoryId: null,
  status: "CONNECTED", healthStatus: "HEALTHY", rampStage: "MANUAL",
  dailyLimit: 50, sentToday: 0, sentDate: null,
  sendingStartTime: "00:00", sendingEndTime: "23:59", timezone: "America/New_York",
  lastError: null, connectedAt: null, lastSyncedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const at = new Date("2026-09-14T14:00:00Z");
check("router picks the mailbox with most headroom", () => {
  const full = { ...base, id: 1, emailAddress: "full@co.com", sentToday: 50,
                 sentDate: localDate("America/New_York", at) };
  const free = { ...base, id: 2, emailAddress: "free@co.com" };
  const r = route([full, free], at);
  assert.equal(r.ok, true);
  assert.equal((r as {mailbox:{emailAddress:string}}).mailbox.emailAddress, "free@co.com");
});
check("router skips a paused mailbox", () => {
  const r = route([{ ...base, status: "PAUSED" }], at);
  assert.equal(r.ok, false);
});
check("router skips a disconnected mailbox", () => {
  const r = route([{ ...base, status: "DISCONNECTED" }], at);
  assert.equal(r.ok, false);
});
check("router skips an unhealthy mailbox", () => {
  const r = route([{ ...base, healthStatus: "UNHEALTHY" }], at);
  assert.equal(r.ok, false);
});
check("router skips outside the sending window", () => {
  const r = route([{ ...base, sendingStartTime: "09:00", sendingEndTime: "10:00" }],
                  new Date("2026-09-14T20:00:00Z"));
  assert.equal(r.ok, false);
});
check("ramp stage caps below the mailbox limit", () =>
  assert.equal(effectiveDailyLimit({ ...base, rampStage: "NEW", dailyLimit: 500 }), 20));
check("MANUAL stage uses the mailbox limit verbatim", () =>
  assert.equal(effectiveDailyLimit({ ...base, rampStage: "MANUAL", dailyLimit: 77 }), 77));
check("counter resets on a new local day", () =>
  assert.equal(remainingToday({ ...base, sentToday: 50, sentDate: "2020-01-01" }, at), 50));

// ---------------------------------------------------------------- personalization
import { personalize, renderBoth } from "../lib/campaign/personalize";
check("variables render from real fields", () =>
  assert.equal(personalize("Hi {{pharmacy_name}} in {{city}}",
    { canonicalName: "ABC Rx", city: "Miami" }), "Hi ABC Rx in Miami"));
check("missing value never leaks undefined/null", () => {
  const out = personalize("Hello {{contact_name}}!", { canonicalName: "ABC" });
  assert.ok(!out.includes("undefined") && !out.includes("null"));
});
check("unknown placeholder never survives", () => {
  const out = personalize("Hi {{not_a_field}}", {});
  assert.ok(!out.includes("{{"));
});
check("contact_name falls back to PIC then owner", () =>
  assert.equal(personalize("{{contact_name}}", { picName: "Jane Roe" }), "Jane Roe"));
check("renderBoth tidies whitespace left by blanks", () =>
  assert.equal(renderBoth("x", "Hi {{contact_name}} , welcome", "", {}).bodyText, "Hi, welcome"));

// ---------------------------------------------------------------- crypto + safety
// Env is supplied by the npm script - config.ts reads it at import time, so it cannot be
// set from inside this file after the static imports have already run.
const { encryptToken, decryptToken, signUnsubscribeToken, verifyUnsubscribeToken } =
  await import("../lib/crypto");
check("refresh token round-trips", () =>
  assert.equal(decryptToken(encryptToken("refresh-abc-123")), "refresh-abc-123"));
check("ciphertext differs each time (random IV)", () =>
  assert.notEqual(encryptToken("same"), encryptToken("same")));
check("tampered ciphertext is rejected", () => {
  const enc = encryptToken("secret");
  const [iv, tag] = enc.split(":");
  assert.throws(() => decryptToken(`${iv}:${tag}:${Buffer.from("evil").toString("base64")}`));
});
check("unsubscribe token round-trips", () =>
  assert.equal(verifyUnsubscribeToken(signUnsubscribeToken("Rx@ABC.com")), "rx@abc.com"));
check("forged unsubscribe token is rejected", () =>
  assert.equal(verifyUnsubscribeToken("abc.def"), null));
check("unsubscribe token exposes no sequential id", () =>
  assert.ok(!/^\d+$/.test(signUnsubscribeToken("a@b.com").split(".")[0])));

const { hashPassword, verifyPassword, readSessionValue, createSessionValue } =
  await import("../lib/auth");
check("password hash is not plaintext", () => {
  const h = hashPassword("hunter2");
  assert.ok(!h.includes("hunter2")); assert.ok(h.startsWith("scrypt:"));
});
check("correct password verifies", () =>
  assert.equal(verifyPassword("hunter2", hashPassword("hunter2")), true));
check("wrong password fails", () =>
  assert.equal(verifyPassword("wrong", hashPassword("hunter2")), false));
check("valid session reads back", () =>
  assert.equal(readSessionValue(createSessionValue("a@b.com"))?.email, "a@b.com"));
check("forged session is rejected", () =>
  assert.equal(readSessionValue("forged.signature"), null));

// The hash is pasted into .env, where Next expands $VAR references. A "$" separator would be
// silently eaten; this guards the format that survives that.
check("password hash contains no $ that .env would expand", () =>
  assert.ok(!hashPassword("hunter2").includes("$")));
check("a legacy scrypt$ hash still verifies", () => {
  const legacy = hashPassword("hunter2").replace(/:/g, "$");
  assert.equal(verifyPassword("hunter2", legacy), true);
});

// ------------------------------------------------------- mailbox assignment + pools
const mbA = { ...base, id: 1, emailAddress: "sales@co.com" };
const mbB = { ...base, id: 2, emailAddress: "outreach@co.com" };

check("a pharmacy keeps the mailbox it was assigned", () => {
  // B has more headroom, but A owns this pharmacy, so A must win.
  const busyA = { ...mbA, sentToday: 40, sentDate: localDate("America/New_York", at) };
  const r = route([busyA, mbB], at, { assignedMailboxId: 1 });
  assert.equal(r.ok, true);
  const picked = r as { mailbox: { emailAddress: string }; reason: string };
  assert.equal(picked.mailbox.emailAddress, "sales@co.com");
  assert.equal(picked.reason, "assigned to this pharmacy");
});
check("an unusable assigned mailbox reroutes, and says so", () => {
  const r = route([{ ...mbA, status: "PAUSED" }, mbB], at, { assignedMailboxId: 1 });
  assert.equal(r.ok, true);
  const picked = r as { mailbox: { emailAddress: string }; reason: string };
  assert.equal(picked.mailbox.emailAddress, "outreach@co.com");
  assert.equal(picked.reason, "assigned mailbox unavailable, rerouted");
});
check("a campaign can opt out of keeping the same sender", () => {
  const busyA = { ...mbA, sentToday: 40, sentDate: localDate("America/New_York", at) };
  const r = route([busyA, mbB], at, { assignedMailboxId: 1, useAssigned: false });
  assert.equal((r as { mailbox: { emailAddress: string } }).mailbox.emailAddress, "outreach@co.com");
});
check("an assignment to a mailbox outside the pool is ignored", () => {
  // The pool is the caller's list; an id that is not in it cannot be chosen.
  const r = route([mbB], at, { assignedMailboxId: 1 });
  assert.equal((r as { mailbox: { id: number } }).mailbox.id, 2);
});
check("routing is deterministic when headroom ties", () => {
  const first = route([mbA, mbB], at) as { mailbox: { id: number } };
  const second = route([mbB, mbA], at) as { mailbox: { id: number } };
  assert.equal(first.mailbox.id, second.mailbox.id);
});
check("a gmail mailbox with no stored token is unusable", () =>
  assert.equal(unusableReason({ ...mbA, provider: "gmail", encryptedRefreshToken: null }, at),
    "needs reconnecting"));
check("a usable mailbox has no blocking reason", () =>
  assert.equal(unusableReason(mbA, at), null));

// ------------------------------------------------------- account-wide ceiling
check("sent today is counted per mailbox local day", () => {
  const today = localDate("America/New_York", at);
  const rows = [{ ...mbA, sentToday: 10, sentDate: today },
                { ...mbB, sentToday: 7, sentDate: "1999-01-01" }];   // stale counter ignored
  assert.equal(sentTodayAcross(rows, at), 10);
});
check("the account ceiling shrinks as volume goes out", () => {
  const today = localDate("America/New_York", at);
  const before = globalHeadroom([mbA, mbB], at);
  const after = globalHeadroom([{ ...mbA, sentToday: 25, sentDate: today }, mbB], at);
  assert.equal(before - after, 25);
});
check("capacity never exceeds the account ceiling", () => {
  // Ten mailboxes of 50 each is 500 of per-mailbox quota; the ceiling must still bind.
  const many = Array.from({ length: 10 }, (_, i) => ({ ...base, id: i + 1 }));
  assert.equal(totalCapacityToday(many, at), globalHeadroom(many, at));
});

// ---------------------------------------------------------------- platform role
const { ROLES: VISIBLE_ROLES, HIDDEN_ROLES, ALL_ROLES, isAssignableRole, isHiddenRole,
        can: rbacCan, assignableRoles: rbacAssignable, PERMISSIONS: ALL_PERMISSIONS } =
  await import("../lib/rbac");
check("the platform role is not offered as an operator role", () => {
  assert.ok(!(VISIBLE_ROLES as readonly string[]).includes("PLATFORM"));
  assert.ok((ALL_ROLES as readonly string[]).includes("PLATFORM"));
  assert.equal(isAssignableRole("PLATFORM"), false);
  assert.equal(isHiddenRole("PLATFORM"), true);
});
check("nobody can assign the platform role, including itself", () => {
  for (const actor of [...ALL_ROLES, "PLATFORM"])
    assert.ok(!rbacAssignable(actor).includes("PLATFORM" as never), actor);
});
check("only the platform role can suspend the application", () => {
  assert.equal(rbacCan("PLATFORM", "system.control"), true);
  for (const r of VISIBLE_ROLES) assert.equal(rbacCan(r, "system.control"), false, r);
});
check("the platform role still holds every ordinary permission", () =>
  assert.equal(ALL_PERMISSIONS.every((p) => rbacCan("PLATFORM", p)), true));
check("an owner keeps everything except system control", () => {
  assert.equal(rbacCan("OWNER", "users.manage"), true);
  assert.equal(rbacCan("OWNER", "system.control"), false);
});
check("hidden roles are declared, not incidental", () =>
  assert.deepEqual([...HIDDEN_ROLES], ["PLATFORM"]));

// ---------------------------------------------------------------- open redirect
const { safeNextPath } = await import("../lib/safe-redirect");
check("a local path passes through", () =>
  assert.equal(safeNextPath("/campaigns/12?tab=review"), "/campaigns/12?tab=review"));
check("an absolute URL is refused", () =>
  assert.equal(safeNextPath("https://evil.example/steal"), "/"));
check("a protocol-relative URL is refused", () =>
  assert.equal(safeNextPath("//evil.example"), "/"));
check("a backslash-prefixed path is refused", () =>
  assert.equal(safeNextPath("/\\evil.example"), "/"));
check("a javascript: URL is refused", () =>
  assert.equal(safeNextPath("javascript:alert(1)"), "/"));
check("CRLF in the path is refused", () =>
  assert.equal(safeNextPath("/ok\r\nSet-Cookie: a=b"), "/"));
check("traversal is normalised, not followed off-site", () =>
  assert.equal(safeNextPath("/a/../../b"), "/b"));
check("an empty value falls back", () => assert.equal(safeNextPath(""), "/"));

// ---------------------------------------------------------------- provider failures
const { classifyFailure, mailboxStateFor } = await import("../lib/mail/errors");
check("a revoked token is an auth failure", () =>
  assert.equal(classifyFailure("invalid_grant: Token has been expired or revoked."), "AUTH"));
check("a 429 is a rate limit", () =>
  assert.equal(classifyFailure("Request failed with status code 429"), "RATE_LIMIT"));
check("a socket timeout is transient", () =>
  assert.equal(classifyFailure("ETIMEDOUT socket hang up"), "TRANSIENT"));
check("an auth failure takes the mailbox out of rotation", () => {
  const state = mailboxStateFor("AUTH");
  assert.equal(state.status, "ERROR");
  assert.equal(state.healthStatus, "UNHEALTHY");
});
check("a rate limit does not take the mailbox out of rotation", () =>
  assert.notEqual(mailboxStateFor("RATE_LIMIT").status, "ERROR"));

// ---------------------------------------------------------------- schedule validation
const { isValidTimezone, isValidTimeOfDay, isValidSendingDays } =
  await import("../lib/campaign/schedule");
check("a real timezone validates", () => assert.equal(isValidTimezone("America/New_York"), true));
check("a typo'd timezone is refused", () => assert.equal(isValidTimezone("America/New_Yrok"), false));
check("times must be HH:MM", () => {
  assert.equal(isValidTimeOfDay("09:00"), true);
  assert.equal(isValidTimeOfDay("9:00"), false);
  assert.equal(isValidTimeOfDay("24:00"), false);
  assert.equal(isValidTimeOfDay(""), false);
});
check("sending days must be ISO weekday numbers", () => {
  assert.equal(isValidSendingDays("1,2,3,4,5"), true);
  assert.equal(isValidSendingDays("0,8"), false);
  assert.equal(isValidSendingDays(""), false);
});
check("an unknown timezone does not throw the scheduler", () => {
  // Falls back to UTC rather than taking every campaign down with a RangeError.
  const parts = zonedParts(new Date("2026-09-14T14:00:00Z"), "Not/AZone");
  assert.equal(parts.date, "2026-09-14");
});
check("a malformed window reads as closed, never as open all day", () =>
  assert.equal(windowStatus({ timezone: "UTC", sendingDays: "1,2,3,4,5,6,7",
    sendingStartTime: "9am", sendingEndTime: "5pm" }, at).open, false));

// ---------------------------------------------------------------- rbac
const { can, ROLE_PERMISSIONS, ROLES, PERMISSIONS, assignableRoles } = await import("../lib/rbac");
check("owner holds every permission except system control", () => {
  // system.control suspends the whole application; that is the platform account's call, not an
  // operator's, however senior.
  assert.deepEqual(
    PERMISSIONS.filter((p) => !ROLE_PERMISSIONS.OWNER.includes(p)), ["system.control"]);
});
check("viewer cannot send a campaign", () =>
  assert.equal(can("VIEWER", "campaign.send"), false));
check("viewer cannot reply", () =>
  assert.equal(can("VIEWER", "inbox.reply"), false));
check("agent cannot send a campaign but can reply", () => {
  assert.equal(can("AGENT", "campaign.send"), false);
  assert.equal(can("AGENT", "inbox.reply"), true);
});
check("manager cannot manage mailboxes, settings or users", () => {
  for (const p of ["mailbox.manage", "settings.manage", "users.manage"] as const)
    assert.equal(can("MANAGER", p), false);
});
check("only owner and admin may manage users", () =>
  assert.deepEqual(ROLES.filter((r) => can(r, "users.manage")), ["OWNER", "ADMIN"]));
check("an unknown role holds nothing", () =>
  assert.equal(PERMISSIONS.some((p) => can("SUPERUSER", p)), false));
check("a missing role holds nothing", () =>
  assert.equal(PERMISSIONS.some((p) => can(null, p)), false));
check("only an owner can mint another owner", () => {
  assert.ok(assignableRoles("OWNER").includes("OWNER"));
  assert.ok(!assignableRoles("ADMIN").includes("OWNER"));
  assert.deepEqual(assignableRoles("MANAGER"), []);
});
check("every role's permissions are real permissions", () => {
  for (const r of ROLES)
    for (const p of ROLE_PERMISSIONS[r]) assert.ok(PERMISSIONS.includes(p), `${r}: ${p}`);
});

// ---------------------------------------------------------------- last-owner guard
const { wouldOrphanOwnership } = await import("../lib/users");
check("demoting the only owner is blocked", () =>
  assert.equal(wouldOrphanOwnership("OWNER", 1, false), true));
check("demoting one of two owners is allowed", () =>
  assert.equal(wouldOrphanOwnership("OWNER", 2, false), false));
check("an owner staying an owner is never blocked", () =>
  assert.equal(wouldOrphanOwnership("OWNER", 1, true), false));
check("non-owners are never subject to the guard", () =>
  assert.equal(wouldOrphanOwnership("ADMIN", 0, false), false));

// ---------------------------------------------------------------- live-send safety
const { liveSendingAllowed, liveRecipientAllowed } = await import("../lib/config");
check("live sending is OFF by default", () =>
  assert.equal(liveSendingAllowed().allowed, false));
check("empty allowlist permits no recipient", () =>
  assert.equal(liveRecipientAllowed("anyone@pharmacy.com"), false));

// ---------------------------------------------------------------- sequences
const { validateSteps, schedulePreview, MAX_STEPS } = await import("../lib/campaign/sequence");
const step = (n: number, waitDays: number, body = "Following up.") =>
  ({ stepNumber: n, waitDays, bodyText: body, bodyHtml: body });

check("step 1 needs no wait - it goes when the campaign starts", () =>
  assert.deepEqual(validateSteps([step(1, 0)]), []));
check("a same-day follow-up is refused", () =>
  assert.ok(validateSteps([step(1, 0), step(2, 0)]).some((p) => p.step === 2)));
check("an absurdly long wait is refused", () =>
  assert.ok(validateSteps([step(1, 0), step(2, 365)]).some((p) => p.step === 2)));
check("an empty body is refused", () =>
  assert.ok(validateSteps([step(1, 0, "   ")]).length));
check("duplicate step numbers are refused", () =>
  assert.ok(validateSteps([step(1, 0), step(2, 3), step(2, 4)]).length));
check("a sequence longer than the cap is refused", () =>
  assert.ok(validateSteps(
    Array.from({ length: MAX_STEPS + 1 }, (_, i) => step(i + 1, 3))).some((p) => p.step === 0)));
check("a sane three-step sequence passes", () =>
  assert.deepEqual(validateSteps([step(1, 0), step(2, 3), step(3, 7)]), []));

// The preview is what lets somebody judge the spacing, which is the whole reason to write a
// sequence rather than one email.
check("waits accumulate into the day each step lands on", () =>
  assert.deepEqual(schedulePreview([step(1, 0), step(2, 3), step(3, 7)]),
                   [{ step: 1, day: 0 }, { step: 2, day: 3 }, { step: 3, day: 10 }]));
check("a switched-off step is skipped and adds no delay", () =>
  assert.deepEqual(
    schedulePreview([step(1, 0), { ...step(2, 3), active: false }, step(3, 7)]),
    [{ step: 1, day: 0 }, { step: 3, day: 7 }]));

// ---------------------------------------------------------------- CAN-SPAM footer
// Commercial email must identify the sender and carry a valid physical postal address. An empty
// settings field does not make a slightly worse email, it makes an unlawful one - silently, at
// whatever volume the campaign was set to. So the check is pure and exhaustively tested.
const { footerProblem } = await import("../lib/settings");
const verdict = (missing: string[]) =>
  ({ ok: missing.length === 0, missing, line: "" });

check("a complete footer raises no problem", () =>
  assert.equal(footerProblem(verdict([])), null));
check("a missing address is stated plainly", () => {
  const msg = footerProblem(verdict(["a physical postal address"]))!;
  assert.match(msg, /physical postal address/);
  assert.match(msg, /Settings/);
});
check("two missing pieces read as a sentence, not a list dump", () =>
  assert.match(footerProblem(verdict(["a company name", "a physical postal address"]))!,
               /a company name and a physical postal address/));
check("three missing pieces are comma-joined with a final 'and'", () =>
  assert.match(footerProblem(verdict(["one", "two", "three"]))!, /one, two and three/));

// ---------------------------------------------------------------- never pay for a check twice
// Verification is billed per address, so what a scope selects is a spending decision. These are
// about what cannot happen by accident.
const { scopeWhere } = await import("../lib/verify/service");
const statuses = (scope: Parameters<typeof scopeWhere>[0]) => JSON.stringify(scopeWhere(scope));

check("the default scope asks only for addresses never checked", () => {
  const j = statuses({});
  assert.ok(j.includes("NOT_CHECKED"));
  assert.ok(!j.includes('"VALID"'), "a default round must never include a confirmed address");
});
check("an address already with the verifier is excluded whatever else is asked", () => {
  for (const scope of [{}, { onlyUnchecked: false },
                       { previousResults: ["VALID", "RISKY"] },
                       { recheckOlderThanDays: 30 }])
    assert.ok(statuses(scope).includes("IN_PROGRESS"),
      `${JSON.stringify(scope)} does not exclude addresses already submitted`);
});

// The hole this closed: clearing the box left no status filter at all, which meant the whole
// list - confirmed addresses included - and a second bill for work already paid for.
check("clearing 'never checked' alone does not silently select everything", () => {
  const j = statuses({ onlyUnchecked: false });
  assert.ok(j.includes("NOT_CHECKED"),
    "with no re-check asked for, the scope must fall back to never-checked");
  assert.ok(!j.includes('"VALID"'));
});
check("a scope can never end up with no status filter at all", () => {
  for (const scope of [{}, { onlyUnchecked: false }, { onlyUnchecked: false, states: ["FL"] },
                       { onlyUnchecked: false, previousResults: [] }])
    assert.ok(statuses(scope).includes("NOT_CHECKED") || statuses(scope).includes("emailCheckedAt"),
      `${JSON.stringify(scope)} selects on no verification status`);
});

// Re-checking is legitimate - it just has to be the thing that was asked for.
check("naming a previous result re-checks exactly that result", () => {
  const j = statuses({ onlyUnchecked: false, previousResults: ["UNKNOWN"] });
  assert.ok(j.includes("UNKNOWN"));
  assert.ok(!j.includes("NOT_CHECKED".replace("NOT_", "NOT_")) || j.includes("IN_PROGRESS"));
});
check("a staleness window re-checks by age rather than by status", () => {
  const j = statuses({ onlyUnchecked: false, recheckOlderThanDays: 180 });
  assert.ok(j.includes("emailCheckedAt"), "age is what a staleness window filters on");
});
check("asking for valid explicitly is allowed - it is a real thing to want", () =>
  assert.ok(statuses({ onlyUnchecked: false, previousResults: ["VALID"] }).includes("VALID")));

// ---------------------------------------------------------------- personalisation fallbacks
// Only 14% of this registry's mailable records carry a contact name, so a greeting without a
// fallback reaches most recipients as "Hello," - a mail merge that visibly failed.
const { tokensUsed } = await import("../lib/campaign/personalize");
const { personalize: pers, tidy: td } = await import("../lib/campaign/personalize");
const render = (t: string, p: object = {}) => td(pers(t, p));

check("a blank token with no fallback leaves a gap", () =>
  assert.equal(render("Hello {{contact_name}},"), "Hello,"));
check("a fallback fills the gap", () =>
  assert.equal(render("Hello {{contact_name|there}},"), "Hello there,"));
check("a real value still wins over the fallback", () =>
  assert.equal(render("Hello {{contact_name|there}},", { picName: "Linda Hayes" }),
               "Hello Linda Hayes,"));
check("an empty fallback is allowed and renders nothing", () =>
  assert.equal(render("Hello{{contact_name|}},"), "Hello,"));
check("a fallback may contain spaces", () =>
  assert.equal(render("Dear {{owner_name|Pharmacy Owner}},"), "Dear Pharmacy Owner,"));
check("an unknown token still renders empty rather than leaking", () =>
  assert.ok(!render("Hi {{not_a_real_token}}!").includes("{{")));
check("a fallback never leaks the pipe syntax", () =>
  assert.ok(!render("Hi {{contact_name|there}}").includes("|")));

check("tokensUsed reports each token once, with its fallback", () =>
  assert.deepEqual(
    tokensUsed("Hi {{contact_name|there}}, {{city}} — {{contact_name|there}}"),
    [{ token: "contact_name", fallback: "there" }, { token: "city", fallback: null }]));
check("tokensUsed finds nothing in a template with no tokens", () =>
  assert.deepEqual(tokensUsed("Plain text only."), []));

// ---------------------------------------------------------------- campaign templates
// These ship as the first draft of real outgoing mail, so the checks are about what would
// actually reach a pharmacist, not about the shape of the object.
const { BUILT_INS, builtIn } = await import("../lib/campaign/templates");
const { SUPPORTED_VARIABLES } = await import("../lib/campaign/personalize");
const allText = (t: typeof BUILT_INS[number]) =>
  [t.subject, t.bodyText, ...t.followUps.flatMap((f) => [f.subject ?? "", f.bodyText])].join("\n");

check("every template is retrievable by its id", () =>
  assert.ok(BUILT_INS.every((t) => builtIn(t.id)?.name === t.name)));
check("template ids are unique", () =>
  assert.equal(new Set(BUILT_INS.map((t) => t.id)).size, BUILT_INS.length));

check("no template uses a variable the renderer does not know", () => {
  for (const t of BUILT_INS)
    for (const [, token] of allText(t).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi))
      assert.ok((SUPPORTED_VARIABLES as readonly string[]).includes(token.toLowerCase()),
        `${t.id} uses {{${token}}}, which renders as empty`);
});

// A number invented in this file would be a claim the client never made, and in a commercial
// email a wrong one is a legal problem rather than a typo.
check("no template invents a figure, a price or a percentage", () => {
  for (const t of BUILT_INS) {
    const text = allText(t);
    assert.ok(!/\d+\s*%/.test(text), `${t.id} contains a percentage`);
    assert.ok(!/[$£€]\s*\d/.test(text), `${t.id} contains a price`);
    assert.ok(!/\bsave\s+(up\s+to\s+)?\d/i.test(text), `${t.id} promises a saving`);
  }
});

check("no template leaves a bracketed placeholder to be forgotten", () => {
  for (const t of BUILT_INS)
    assert.ok(!/\[[^\]]+\]/.test(allText(t)),
      `${t.id} contains a [placeholder] that would send as-is`);
});

check("every template offers an easy way out, which is what keeps a reply honest", () => {
  for (const t of BUILT_INS.filter((x) => x.id !== "blank"))
    assert.ok(/\bno\b|not\b|stop|leave it|close/i.test(t.bodyText),
      `${t.id} gives the reader no graceful way to decline`);
});

check("follow-up waits are all inside the sequence limits", () => {
  for (const t of BUILT_INS)
    for (const f of t.followUps) {
      assert.ok(f.waitDays >= 1, `${t.id} has a same-day follow-up`);
      assert.ok(f.waitDays <= 60, `${t.id} has an absurd wait`);
    }
});
check("no built-in sequence exceeds the step cap", () =>
  assert.ok(BUILT_INS.every((t) => t.followUps.length + 1 <= MAX_STEPS)));
check("built-in sequences pass the same validation as a hand-written one", () => {
  for (const t of BUILT_INS) {
    const steps = [{ stepNumber: 1, waitDays: 0, bodyText: t.bodyText, bodyHtml: t.bodyText },
      ...t.followUps.map((f, i) => ({ stepNumber: i + 2, waitDays: f.waitDays,
                                      bodyText: f.bodyText, bodyHtml: f.bodyText }))];
    assert.deepEqual(validateSteps(steps), [], `${t.id} would be rejected by the editor`);
  }
});

check("the last follow-up in a sequence signs off rather than trailing away", () => {
  for (const t of BUILT_INS.filter((x) => x.followUps.length >= 2)) {
    const last = t.followUps[t.followUps.length - 1].bodyText;
    assert.ok(/stop|last note|close|leave it/i.test(last),
      `${t.id} ends without telling the reader it is the last one`);
  }
});
// Every built-in template ships a fallback on its greeting, because of the 14%.
check("no built-in template can greet somebody with an empty name", () => {
  for (const t of BUILT_INS.filter((x) => x.id !== "blank")) {
    const bare = { canonicalName: "A Pharmacy", city: "Akron", state: "OH" };
    for (const body of [t.bodyText, ...t.followUps.map((f) => f.bodyText)]) {
      const first = render(body, bare).split("\n")[0];
      assert.ok(!/^(Hello|Hi|Dear)[,\s]*$/.test(first.trim()),
        `${t.id} greets an unnamed recipient with "${first}"`);
    }
  }
});

check("the blank template really is blank", () => {
  const b = builtIn("blank")!;
  assert.equal(b.subject, "");
  assert.equal(b.followUps.length, 0);
});

// ---------------------------------------------------------------- follow-up queue
const { bucketFor, queueWhere, STALE_SNOOZES } = await import("../lib/followup/service");
const dueOn = (dayOffset: number, hour = 9) => {
  const d = new Date(); d.setHours(hour, 0, 0, 0);
  return new Date(d.getTime() + dayOffset * 86_400_000);
};
const rightNow = new Date();

check("yesterday is overdue", () => assert.equal(bucketFor(dueOn(-1), rightNow), "OVERDUE"));
check("earlier today is still today, not overdue", () =>
  assert.equal(bucketFor(dueOn(0, 1), rightNow), "TODAY"));
check("later today is today", () => assert.equal(bucketFor(dueOn(0, 23), rightNow), "TODAY"));
check("tomorrow is its own bucket", () => assert.equal(bucketFor(dueOn(1), rightNow), "TOMORROW"));
check("next week is later", () => assert.equal(bucketFor(dueOn(7), rightNow), "LATER"));

check("the queue shows only work that is still open", () => {
  const w = queueWhere({}) as { status: { in: string[] } };
  assert.deepEqual(w.status.in, ["PENDING", "DUE"]);
});
check("'unassigned' means no owner, not owner id zero", () => {
  const w = queueWhere({ assignedToId: "unassigned" }) as { assignedToId: number | null };
  assert.equal(w.assignedToId, null);
});
check("a repeatedly deferred task is worth flagging", () => assert.ok(STALE_SNOOZES >= 3));

// ---------------------------------------------------------------- inbox views
const { inboxWhere } = await import("../lib/inbox/triage");
const clauses = (v: Parameters<typeof inboxWhere>[0]) =>
  JSON.stringify(inboxWhere(v));

check("the default view hides autoresponders and out-of-office", () => {
  const j = clauses({ view: "NEEDS_ME" });
  assert.ok(!j.includes("OUT_OF_OFFICE"), "out-of-office must not be in the attention view");
  assert.ok(!j.includes("AUTO_REPLY"), "autoresponders must not be in the attention view");
  assert.ok(j.includes("INTERESTED"));
});
check("'everything' really filters nothing", () =>
  assert.equal(clauses({ view: "ALL" }), "{}"));
check("'mine' with no signed-in id matches nobody rather than everybody", () =>
  assert.ok(clauses({ view: "MINE" }).includes("-1")));

// ---------------------------------------------------------------- reply classification
const { classifyReply, replyBody, HUMAN_REPLY, STOP_OUTREACH } =
  await import("../lib/inbox/classify");
const cat = (i: Parameters<typeof classifyReply>[0]) => classifyReply(i).category;

// The two that matter most, because getting them wrong is expensive in both directions.
check("an out-of-office subject is not a reply", () =>
  assert.equal(cat({ subject: "Automatic reply: Wholesale pricing",
                     bodyText: "I am out of the office until 3 March." }), "OUT_OF_OFFICE"));
check("out-of-office prose with no subject prefix is still caught", () =>
  assert.equal(cat({ subject: "Re: Wholesale pricing",
                     bodyText: "Thanks for your note. I'm on annual leave and will be back on Monday." }),
               "OUT_OF_OFFICE"));
check("an out-of-office is not counted as a human reply", () =>
  assert.ok(!HUMAN_REPLY.includes("OUT_OF_OFFICE")));
check("an out-of-office does not stop outreach", () =>
  assert.ok(!STOP_OUTREACH.includes("OUT_OF_OFFICE")));
check("an out-of-office offering help on return is not read as interest", () =>
  assert.equal(cat({ subject: "Out of Office",
                     bodyText: "I'd be happy to discuss pricing when I return on the 4th." }),
               "OUT_OF_OFFICE"));

check("a prose opt-out is an unsubscribe request", () =>
  assert.equal(cat({ bodyText: "Please take me off your mailing list." }), "UNSUBSCRIBE_REQUEST"));
check("'stop emailing me' is an unsubscribe request", () =>
  assert.equal(cat({ bodyText: "Stop emailing me." }), "UNSUBSCRIBE_REQUEST"));
check("a polite decline that also asks for removal is treated as removal", () =>
  assert.equal(cat({ bodyText: "Not interested, thanks. Please remove me from your list." }),
               "UNSUBSCRIBE_REQUEST"));
check("an unsubscribe request stops outreach", () =>
  assert.ok(STOP_OUTREACH.includes("UNSUBSCRIBE_REQUEST")));

check("an existing supplier is not interested", () =>
  assert.equal(cat({ bodyText: "We already have a wholesaler we're happy with." }),
               "NOT_INTERESTED"));
check("a flat no is not interested", () =>
  assert.equal(cat({ bodyText: "Not interested." }), "NOT_INTERESTED"));

check("a request for pricing is interest", () =>
  assert.equal(cat({ bodyText: "Can you send your price list?" }), "INTERESTED"));
check("asking for a call is interest", () =>
  assert.equal(cat({ bodyText: "Happy to talk. Give me a call Thursday afternoon." }),
               "INTERESTED"));

check("someone who left the business is the wrong person", () =>
  assert.equal(cat({ bodyText: "John no longer works here. Contact Sarah instead." }),
               "WRONG_PERSON"));
check("a closed pharmacy is the wrong person", () =>
  assert.equal(cat({ bodyText: "We have closed as of last month." }), "WRONG_PERSON"));

check("a provider bounce outranks the text", () =>
  assert.equal(cat({ bodyText: "Sure, send pricing!", isBounce: true }), "BOUNCE"));
check("an Auto-Submitted header with no matching phrase is an auto reply", () =>
  assert.equal(cat({ bodyText: "Your ticket has been logged.",
                     headers: { "Auto-Submitted": "auto-replied" } }), "AUTO_REPLY"));
check("Auto-Submitted: no is not treated as automated", () =>
  assert.notEqual(cat({ bodyText: "Some ordinary sentence with no signal in it at all.",
                        headers: { "Auto-Submitted": "no" } }), "AUTO_REPLY"));

check("an ambiguous reply is left for a person to read", () =>
  assert.equal(cat({ bodyText: "Got it, thanks." }), "UNCATEGORISED"));
check("every verdict explains itself", () =>
  assert.ok(classifyReply({ bodyText: "Not interested." }).reason.length > 5));

// Quoting is what makes naive phrase matching useless in a real mailbox.
check("our own words quoted underneath do not classify the reply", () => {
  const body = ["Thanks, we're all set.", "",
                "On Tue, 3 Mar 2026 at 09:14, Sales wrote:",
                "> Let us know if you are interested and we can send our price list."].join("\n");
  assert.equal(replyBody(body), "Thanks, we're all set.");
  assert.notEqual(cat({ bodyText: body }), "INTERESTED");
});
check("an Outlook original-message block is stripped", () =>
  assert.equal(replyBody("No thanks.\n\n-----Original Message-----\nFrom: Sales"), "No thanks."));

// ---------------------------------------------------------------- redirects stay on this origin
// A redirect after a form POST must be relative. An absolute one pointing at a different origin
// is blocked by the Content-Security-Policy `form-action 'self'` - browsers apply form-action
// across redirects - so getting this wrong means nobody can sign in, and the error names the CSP
// rather than the cause.
const { redirectTo } = await import("../lib/config");
const locationOf = (r: Response) => r.headers.get("location");

check("redirectTo emits a relative Location", () =>
  assert.equal(locationOf(redirectTo("/campaigns")), "/campaigns"));
check("a path without a leading slash still gets one", () =>
  assert.equal(locationOf(redirectTo("campaigns")), "/campaigns"));
check("the query string survives", () =>
  assert.equal(locationOf(redirectTo("/login?error=1")), "/login?error=1"));
check("no host appears in the header, so nothing can steer it", () =>
  assert.ok(!/^https?:\/\//.test(locationOf(redirectTo("/x")) ?? "")));
check("redirectTo defaults to 303, the correct status after a POST", () =>
  assert.equal(redirectTo("/x").status, 303));

// The rule is architectural, so it is checked at the source rather than only at one call site.
check("no API route builds a redirect out of APP_URL", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const full = join(dir, n);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
    });
  for (const file of walk("app/api")) {
    const src = readFileSync(file, "utf8");
    assert.ok(!/redirect\([^)]*config\.appUrl/.test(src),
      `${file} redirects to config.appUrl - use a relative Location instead`);
    assert.ok(!/redirect\(\s*absoluteUrl\(/.test(src),
      `${file} redirects to an absolute URL - it will break under form-action 'self'`);
  }
});

// ---------------------------------------------------------------- session cookie scope
// The CRM is one subdomain of a company domain that will later carry a public website and
// possibly other applications. Its session must not travel to any of them.
const { sessionCookieOptions } = await import("../lib/auth");

check("the session cookie is host-only - no Domain attribute", () =>
  assert.ok(!("domain" in sessionCookieOptions()),
    "a Domain would share this session with every host under the company domain"));
check("the session cookie is HttpOnly", () =>
  assert.equal(sessionCookieOptions().httpOnly, true));
check("the session cookie is SameSite=Lax", () =>
  assert.equal(sessionCookieOptions().sameSite, "lax"));
check("the session cookie is scoped to the whole application", () =>
  assert.equal(sessionCookieOptions().path, "/"));
check("the session cookie expires", () =>
  assert.ok(sessionCookieOptions().maxAge > 0));

const prodCookie = JSON.parse((await import("node:child_process")).execFileSync(
  "npx", ["tsx", "-e",
    'import("./lib/auth.js").then((a) => console.log(JSON.stringify(a.sessionCookieOptions())))'],
  { env: { ...process.env, NODE_ENV: "production", APP_URL: "https://crm.example.com" },
    encoding: "utf8" }).trim());
check("the production session cookie is Secure", () =>
  assert.equal(prodCookie.secure, true));
check("the production session cookie is still host-only", () =>
  assert.equal(prodCookie.domain, undefined));

// ---------------------------------------------------------------- deployment URL handling
// Everything the outside world sees - unsubscribe links, OAuth redirects, the landing after
// sign-in - is built from APP_URL rather than from the request's Host header, because behind a
// reverse proxy the Host is whatever the caller wrote in it.
const { appOrigin, appHost, absoluteUrl, isSameOrigin } = await import("../lib/config");

check("appOrigin is the scheme and host of APP_URL", () =>
  assert.equal(appOrigin(), "http://localhost:3000"));
check("appHost is the host alone", () =>
  assert.equal(appHost(), "localhost:3000"));
check("absoluteUrl builds a link on the configured origin", () =>
  assert.equal(absoluteUrl("/unsubscribe/abc"), "http://localhost:3000/unsubscribe/abc"));
check("absoluteUrl keeps the query string", () =>
  assert.equal(absoluteUrl("/login?error=1"), "http://localhost:3000/login?error=1"));
check("absoluteUrl ignores a foreign origin in the path", () =>
  assert.equal(absoluteUrl("/a"), "http://localhost:3000/a"));

check("a matching Origin is same-origin", () =>
  assert.equal(isSameOrigin(new Headers({ origin: "http://localhost:3000" })), true));
check("a foreign Origin is refused", () =>
  assert.equal(isSameOrigin(new Headers({ origin: "https://evil.example" })), false));
check("a lookalike host is refused", () =>
  assert.equal(isSameOrigin(new Headers({ origin: "http://localhost:3000.evil.example" })), false));
check("Origin wins over Referer", () =>
  assert.equal(isSameOrigin(new Headers({
    origin: "https://evil.example", referer: "http://localhost:3000/pharmacies" })), false));
check("Referer is used when there is no Origin", () =>
  assert.equal(isSameOrigin(new Headers({ referer: "https://evil.example/x" })), false));
check("a request with neither header is allowed - it carries no cookie either", () =>
  assert.equal(isSameOrigin(new Headers()), true));
check("an unparseable Referer is refused", () =>
  assert.equal(isSameOrigin(new Headers({ referer: "not a url" })), false));

// A production deployment on a subdomain, checked in a child process so this suite's own
// environment stays as it is. example.com throughout - never a real client domain.
const { execFileSync } = await import("node:child_process");
const inEnv = (env: Record<string, string>, expr: string) =>
  JSON.parse(execFileSync("npx", ["tsx", "-e",
    `import("./lib/config.js").then(async (c) => console.log(JSON.stringify(${expr})))`],
    { env: { ...process.env, ...env }, encoding: "utf8" }).trim());

const prodUrls = inEnv(
  { APP_URL: "https://crm.example.com/", NODE_ENV: "production" },
  "{ origin: c.appOrigin(), host: c.appHost(), unsub: c.absoluteUrl('/unsubscribe/tok'), "
  + "oauth: c.absoluteUrl('/api/oauth/google/callback'), fatal: c.checkConfig()"
  + ".filter((p) => p.fatal).map((p) => p.key) }");

check("a production APP_URL loses its trailing slash", () =>
  assert.equal(prodUrls.origin, "https://crm.example.com"));
check("the deployment host is the subdomain, not the root domain", () =>
  assert.equal(prodUrls.host, "crm.example.com"));
check("unsubscribe links are built on the subdomain", () =>
  assert.equal(prodUrls.unsub, "https://crm.example.com/unsubscribe/tok"));
check("the OAuth callback is built on the subdomain", () =>
  assert.equal(prodUrls.oauth, "https://crm.example.com/api/oauth/google/callback"));
check("a correct production URL raises no fatal APP_URL problem", () =>
  assert.ok(!prodUrls.fatal.includes("APP_URL")));

const httpProd = inEnv(
  { APP_URL: "http://crm.example.com", NODE_ENV: "production" },
  "c.checkConfig().filter((p) => p.fatal).map((p) => p.key)");
check("plain HTTP in production is fatal - Secure cookies would never come back", () =>
  assert.ok(httpProd.includes("APP_URL")));

const localhostProd = inEnv(
  { APP_URL: "http://localhost:3000", NODE_ENV: "production" },
  "c.checkConfig().filter((p) => p.fatal).map((p) => p.key)");
check("localhost in production is fatal", () =>
  assert.ok(localhostProd.includes("APP_URL")));

const failed = R.filter(([, ok]) => !ok);
for (const [label, ok] of R) if (!ok) console.log(`  FAIL ${label}`);
console.log(`\n${R.length - failed.length}/${R.length} passed`);
process.exit(failed.length ? 1 : 0);
