/**
 * Audit attribution. Every mutation records who did it, not just that it happened - with more
 * than one operator, "admin" is no longer an answer.
 */
import type { Session } from "./auth";

export type Actor = { userId?: number; email: string; role?: string };

export const SYSTEM: Actor = { email: "system" };
export const WORKER: Actor = { email: "worker" };

export function actorOf(session: Session): Actor {
  return { userId: session.userId, email: session.email, role: session.role };
}

/** Spread into an auditEvent.create payload. */
export function actorFields(actor?: Actor) {
  return {
    actor: actor?.email ?? "system",
    actorId: actor?.userId ?? null,
    actorRole: actor?.role ?? null,
  };
}
