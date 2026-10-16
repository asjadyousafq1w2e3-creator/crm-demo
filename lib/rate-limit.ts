/**
 * Login throttling, backed by the database.
 *
 * In-memory counters were not an option: the app is meant to run as more than one container, and
 * a limiter that resets on deploy or is bypassed by hitting a different instance is decoration.
 * The audit log already records every LOGIN_FAILED with its actor, so the counter is a query over
 * rows that had to be written anyway.
 *
 * Two windows, because they defend against different things: per-account stops someone grinding
 * one known address, per-IP stops someone spraying many addresses from one place.
 */
import { prisma } from "./db";

export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_ACCOUNT = 8;
export const MAX_FAILURES_PER_IP = 20;

export type Throttle = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const windowStart = () => new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000);

export async function checkLoginThrottle(email: string, ip: string | null): Promise<Throttle> {
  const since = windowStart();
  const [byAccount, byIp] = await Promise.all([
    email
      ? prisma.auditEvent.count({
          where: { eventType: "LOGIN_FAILED", actor: email, createdAt: { gte: since } } })
      : 0,
    ip
      ? prisma.auditEvent.count({
          where: { eventType: "LOGIN_FAILED", detail: { endsWith: `ip=${ip}` },
                   createdAt: { gte: since } } })
      : 0,
  ]);

  if (byAccount < MAX_FAILURES_PER_ACCOUNT && byIp < MAX_FAILURES_PER_IP) return { allowed: true };

  // Let them try again a window after their oldest recorded failure, not a flat delay.
  const oldest = await prisma.auditEvent.findFirst({
    where: {
      eventType: "LOGIN_FAILED", createdAt: { gte: since },
      OR: [...(email ? [{ actor: email }] : []),
           ...(ip ? [{ detail: { endsWith: `ip=${ip}` } }] : [])],
    },
    orderBy: { createdAt: "asc" }, select: { createdAt: true },
  });
  const readyAt = (oldest?.createdAt.getTime() ?? Date.now()) + LOGIN_WINDOW_MINUTES * 60_000;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((readyAt - Date.now()) / 1000)) };
}

/** Best-effort client address. Trusts the proxy headers a load balancer sets. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64) || null;
  return headers.get("x-real-ip")?.slice(0, 64) ?? null;
}
