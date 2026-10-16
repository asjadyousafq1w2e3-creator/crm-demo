import { NextResponse, type NextRequest } from "next/server";
import { createSessionValue, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { authenticate, bootstrapFromEnv, ensurePlatformAccount } from "@/lib/users";
import { checkLoginThrottle, clientIp } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-redirect";
import { prisma } from "@/lib/db";
import { isCrmShowcase, SHOWCASE_EMAIL, SHOWCASE_PASSWORD } from "@/lib/showcase-mode";


export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  // Never redirect anywhere but inside this application - see lib/safe-redirect.
  const next = safeNextPath(String(form.get("next") ?? "/"));
  const ip = clientIp(req.headers);

  // Relative Location throughout - see redirectTo in lib/config for why that is both safer
  // and the only thing that works when the app is served somewhere APP_URL does not name.
  const seeOther = (path: string) =>
    new NextResponse(null, { status: 303, headers: { Location: path } });

  const fail = (throttled = false) =>
    seeOther(`/login?error=${throttled ? "throttled" : "1"}&next=${encodeURIComponent(next)}`);

  if (isCrmShowcase())
    return email === SHOWCASE_EMAIL && password === SHOWCASE_PASSWORD ? seeOther(next === "/" ? "/crm" : next) : fail();

  const throttle = await checkLoginThrottle(email, ip);
  if (!throttle.allowed) {
    await prisma.auditEvent.create({
      data: { eventType: "LOGIN_THROTTLED", actor: email || "unknown",
              detail: `too many attempts; ip=${ip ?? "unknown"}` } });
    const res = fail(true);
    res.headers.set("Retry-After", String(throttle.retryAfterSeconds));
    return res;
  }

  // First run of a fresh deployment: seed the OWNER from the env values, once.
  await bootstrapFromEnv();
  // Kept in step with the environment on every attempt, so rotating the key takes effect at once.
  await ensurePlatformAccount();

  const result = await authenticate(email, password);
  if (!result.ok) {
    // The ip suffix is what the throttle counts on; keep the format stable.
    await prisma.auditEvent.create({
      data: { eventType: "LOGIN_FAILED", actor: email || "unknown",
              detail: `${result.reason}; ip=${ip ?? "unknown"}` } });
    // The reason is recorded but not shown: telling a stranger an address exists but is
    // suspended is more than they need to know. A system-wide suspension is the exception -
    // that is not a hint about any account, and an operator staring at "wrong password" while
    // their password is fine would be a bad hour for everybody.
    if (result.reason === "system suspended")
      return seeOther(`/login?error=suspended&next=${encodeURIComponent(next)}`);
    return fail();
  }

  await prisma.auditEvent.create({
    data: { eventType: "LOGIN", actor: result.user.email, actorId: result.user.id,
            actorRole: result.user.role, detail: `signed in; ip=${ip ?? "unknown"}` },
  });
  const target = result.user.mustChangePassword ? "/account?first=1" : next;
  // A relative Location: a forged Host header has nothing to influence, and the browser lands
  // on whatever origin actually served the form.
  const res = seeOther(target);
  res.cookies.set(SESSION_COOKIE, createSessionValue(result.user.email, result.user.id),
                  sessionCookieOptions());
  return res;
}

export const runtime = "nodejs";
