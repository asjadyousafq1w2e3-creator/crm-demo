import crypto from "node:crypto";
import { cookies } from "next/headers";
import { forbidden, unauthorized } from "next/navigation";
import { signingSecret } from "./config";
import { prisma } from "./db";
import { can, type Permission, type Role } from "./rbac";
import { isSuspended } from "./system-state";
import { isCrmShowcase, SHOWCASE_SESSION } from "./showcase-mode";

/**
 * Session handling.
 *
 * The cookie carries the user id under an HMAC, but never the role: the role is read from the
 * database on every request, so suspending an account or demoting someone takes effect on their
 * very next click rather than whenever their cookie happens to expire.
 */
const COOKIE = "pharmacy_session";
const MAX_AGE = 60 * 60 * 12;

function sign(payload: string) {
  return crypto.createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function createSessionValue(email: string, userId?: number): string {
  const payload = Buffer.from(JSON.stringify({
    e: email, uid: userId, exp: Date.now() + MAX_AGE * 1000,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Pure signature check. Says nothing about whether the account still exists or is active. */
export function readSessionValue(value: string | undefined):
  { email: string; userId?: number } | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { e, uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return Date.now() > exp ? null : { email: e, userId: uid };
  } catch { return null; }
}

/**
 * scrypt with a per-hash salt. Format: scrypt:<saltHex>:<hashHex>.
 *
 * Colons rather than the conventional "$" separators on purpose: this value lives in .env, and
 * Next.js expands $VAR references when it loads that file - a "$" form is silently truncated to
 * "scrypt" and every login then fails with no useful diagnostic. The "$" form is still accepted
 * on read so an existing hash keeps working.
 */
export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(password, s, 64).toString("hex");
  return `scrypt:${s}:${h}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.includes(":") ? stored.split(":") : stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export type Session = {
  userId: number;
  email: string;
  name: string | null;
  role: Role;
  mustChangePassword: boolean;
};

/** Resolves the cookie to a live account. Returns null for a suspended or deleted user. */
export async function getSession(): Promise<Session | null> {
  if (isCrmShowcase()) return { ...SHOWCASE_SESSION };
  const jar = await cookies();
  const raw = readSessionValue(jar.get(COOKIE)?.value);
  if (!raw) return null;

  const user = await prisma.appUser.findFirst({
    where: raw.userId ? { id: raw.userId } : { email: raw.email.toLowerCase() },
  });
  if (!user || user.status !== "ACTIVE") return null;

  // A suspension has to reach sessions that already exist, otherwise anyone signed in when it
  // was applied simply carries on. The platform account is the exception, or it could not undo it.
  if (user.role !== "PLATFORM" && (await isSuspended())) return null;

  return {
    userId: user.id, email: user.email, name: user.name,
    role: user.role as Role, mustChangePassword: user.mustChangePassword,
  };
}

export class AuthorizationError extends Error {
  constructor(public permission: Permission) {
    super(`FORBIDDEN: ${permission}`);
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  return s;
}

/**
 * The authorisation gate every mutation goes through. Hiding a button is a courtesy; this is
 * the control - a hand-crafted POST hits exactly the same check.
 */
export async function requirePermission(permission: Permission): Promise<Session> {
  if (isCrmShowcase() && !permission.endsWith(".view"))
    throw new Error("Display-only demo: changes and live operations are disabled.");
  const session = await requireSession();
  if (!can(session.role, permission)) throw new AuthorizationError(permission);
  return session;
}

/**
 * Page-level gate. Unlike requirePermission (used by mutations, where throwing is right), this
 * answers with a real 401 or 403 so a viewer who types a URL gets a plain explanation instead of
 * a 500 that looks like a bug.
 */
export async function requirePagePermission(permission: Permission): Promise<Session> {
  const session = await getSession();
  if (!session) unauthorized();
  if (!can(session.role, permission)) forbidden();
  return session;
}

export async function sessionCan(permission: Permission): Promise<boolean> {
  const s = await getSession();
  return can(s?.role, permission);
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE;

/**
 * How the session cookie is written. One definition, so sign-in and sign-out cannot drift.
 *
 * There is deliberately no `domain`. Omitting it makes the cookie host-only: the browser sends
 * it back to crm.example.com and to nothing else. Setting `domain: ".example.com"` would attach
 * this CRM session to every host under the company domain - the public website, a future
 * customer portal, an api host - including ones built later by other people on other platforms.
 * A single cross-site scripting hole in a marketing page would then be a CRM session. The CRM is
 * its own security boundary and keeps its own cookie; if cross-subdomain sign-on is ever wanted,
 * it wants a deliberate design, not a widened cookie.
 *
 * sameSite "lax" rather than "strict": strict would withhold the cookie on the top-level
 * redirect back from Google, and the OAuth callback would arrive with no session. Lax still
 * refuses to send the cookie on a cross-site POST, which is what blocks CSRF.
 *
 * secure follows NODE_ENV because a development server is plain HTTP and a Secure cookie would
 * simply never be stored. Production is https-only, which checkConfig enforces.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  } as const;
}
