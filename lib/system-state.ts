/**
 * Application-wide suspension.
 *
 * A full stop, not a login gate: while suspended nobody but the platform account can sign in,
 * live sessions stop resolving, and the worker sends and syncs nothing. "Paused" that still
 * delivers mail in the background would be worse than no pause at all, because it would be
 * believed.
 *
 * State lives in app_setting so every container sees the same answer immediately - an in-process
 * flag would only pause whichever instance happened to receive the request.
 */
import { prisma } from "./db";

const KEY = "system.suspended";
const REASON = "system.suspended.reason";
const AT = "system.suspended.at";

/** Recorded against platform actions so the audit trail never carries the account's identity. */
export const PLATFORM_ACTOR = "platform";

export type SystemState = {
  suspended: boolean;
  reason: string | null;
  since: Date | null;
};

export async function systemState(): Promise<SystemState> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [KEY, REASON, AT] } } });
  const value = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const at = value(AT);
  return {
    suspended: value(KEY) === "true",
    reason: value(REASON),
    since: at ? new Date(at) : null,
  };
}

export async function isSuspended(): Promise<boolean> {
  return (await systemState()).suspended;
}

async function put(key: string, value: string) {
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function suspendSystem(reason: string): Promise<SystemState> {
  const now = new Date();
  await put(KEY, "true");
  await put(REASON, reason.trim().slice(0, 300));
  await put(AT, now.toISOString());
  await prisma.auditEvent.create({
    data: { eventType: "SYSTEM_SUSPENDED", actor: PLATFORM_ACTOR, actorRole: "PLATFORM",
            detail: reason.trim().slice(0, 300) || "no reason given" },
  });
  return { suspended: true, reason, since: now };
}

export async function resumeSystem(): Promise<SystemState> {
  const before = await systemState();
  await put(KEY, "false");
  await put(REASON, "");
  await prisma.auditEvent.create({
    data: { eventType: "SYSTEM_RESUMED", actor: PLATFORM_ACTOR, actorRole: "PLATFORM",
            detail: before.since
              ? `suspended since ${before.since.toISOString().slice(0, 16).replace("T", " ")}`
              : "resumed" },
  });
  return { suspended: false, reason: null, since: null };
}
