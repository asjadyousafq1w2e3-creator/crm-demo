/**
 * Operator accounts. No auth checks here - the actions layer authorises, this layer enforces the
 * invariants that must hold no matter who is calling.
 */
import { prisma } from "./db";
import { hashPassword, verifyPassword } from "./auth";
import { config } from "./config";
import { assignableRoles, isAssignableRole, isHiddenRole, type Role } from "./rbac";
import { isSuspended } from "./system-state";
import crypto from "node:crypto";

export type PublicUser = {
  id: number; email: string; name: string | null; role: string; status: string;
  mustChangePassword: boolean; lastLoginAt: Date | null; createdAt: Date;
};

const publicFields = {
  id: true, email: true, name: true, role: true, status: true,
  mustChangePassword: true, lastLoginAt: true, createdAt: true,
} as const;

/**
 * Creates the first OWNER from ADMIN_EMAIL / ADMIN_PASSWORD_HASH when the table is empty, so an
 * existing single-admin deployment keeps working after this upgrade without a manual step.
 * Does nothing once any account exists - the env values are a bootstrap, not a back door.
 */
export async function bootstrapFromEnv(): Promise<PublicUser | null> {
  if (await prisma.appUser.count()) return null;
  const email = config.admin.email.trim().toLowerCase();
  if (!email || !config.admin.passwordHash) return null;
  const user = await prisma.appUser.create({
    data: {
      email, name: "Owner", passwordHash: config.admin.passwordHash,
      role: "OWNER", status: "ACTIVE",
    },
    select: publicFields,
  });
  await prisma.auditEvent.create({
    data: { eventType: "USER_CREATED", actor: "bootstrap", detail: `${email} seeded as OWNER` },
  });
  return user;
}

/**
 * Provisions the break-glass account from the environment, and keeps it in step with it.
 *
 * Run on every sign-in rather than once at install: rotating PLATFORM_KEY_HASH then takes effect
 * immediately, and deleting the row by hand does not lock the owner out of their own system.
 */
export async function ensurePlatformAccount(): Promise<void> {
  const { id, hash } = config.platform;
  if (!id || !hash) return;

  const existing = await prisma.appUser.findUnique({ where: { email: id } });
  if (!existing) {
    await prisma.appUser.create({
      data: { email: id, name: "Platform", passwordHash: hash, role: "PLATFORM", status: "ACTIVE" },
    });
    return;
  }

  /*
   * The address already belongs to an operator. Taking it over would silently replace that
   * account's role and password - which is exactly how someone loses access to their own CRM
   * because two settings happened to name the same address. Refuse, loudly, and change nothing.
   */
  if (existing.role !== "PLATFORM") {
    await prisma.auditEvent.create({
      data: { eventType: "PLATFORM_KEY_CONFLICT", actor: "system",
              detail: "PLATFORM_KEY_ID matches an existing operator account; break-glass access "
                    + "is disabled until one of them uses a different address" },
    }).catch(() => { /* never let a log write break a sign-in */ });
    return;
  }

  // Keep the credential aligned with the environment, which is the source of truth for this one
  // account. Nothing else about it is editable from inside the application.
  if (existing.passwordHash !== hash || existing.status !== "ACTIVE") {
    await prisma.appUser.update({
      where: { id: existing.id },
      data: { passwordHash: hash, status: "ACTIVE", mustChangePassword: false },
    });
  }
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.appUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Hash anyway when the account is missing, so a wrong address and a wrong password take the
  // same time to answer.
  const stored = user?.passwordHash ?? hashPassword("no-such-user");
  const ok = verifyPassword(password, stored);
  if (!user || !ok) return { ok: false as const, reason: "invalid" };
  if (user.status !== "ACTIVE") return { ok: false as const, reason: "suspended" };

  // While the application is suspended only the platform account may sign in - otherwise the
  // control could be undone by whoever it was meant to hold off.
  if (user.role !== "PLATFORM" && (await isSuspended()))
    return { ok: false as const, reason: "system suspended" };

  await prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ok: true as const, user };
}

/** Operator accounts only. The platform account is never listed, counted or returned here. */
export function listUsers(): Promise<PublicUser[]> {
  return prisma.appUser.findMany({
    where: { role: { notIn: ["PLATFORM"] } },
    orderBy: [{ role: "asc" }, { email: "asc" }], select: publicFields,
  });
}

export function generatePassword(): string {
  // Ambiguous characters left out so the operator can read it off a screen without mistakes.
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(16))
    .map((b) => alphabet[b % alphabet.length]).join("");
}

export type UserMutation = { ok: true; detail: string; password?: string }
                         | { ok: false; reason: string };

/**
 * Pure: would this change leave the system with no active owner?
 *
 * Kept as a function of its inputs rather than a query so the rule can be tested exhaustively
 * without arranging the whole table - the database only supplies the count.
 */
export function wouldOrphanOwnership(
  targetRole: string, activeOwners: number, ownerAfterwards: boolean,
): boolean {
  return targetRole === "OWNER" && !ownerAfterwards && activeOwners <= 1;
}

function guardRole(actorRole: string, role: string): string | null {
  if (!isAssignableRole(role)) return `unknown role "${role}"`;
  if (!assignableRoles(actorRole).includes(role as Role))
    return `a ${actorRole.toLowerCase()} cannot assign the ${role} role`;
  return null;
}

/**
 * The platform account is not administrable from inside the application: it cannot be renamed,
 * demoted, suspended, reset or deleted by an operator, however senior. It is changed by changing
 * the environment.
 */
function guardTarget(role: string): string | null {
  return isHiddenRole(role) ? "user not found" : null;
}

export async function createUser(
  actor: { userId: number; role: string },
  input: { email: string; name?: string; role: string },
): Promise<UserMutation> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, reason: "invalid email address" };
  const bad = guardRole(actor.role, input.role);
  if (bad) return { ok: false, reason: bad };
  if (await prisma.appUser.findUnique({ where: { email } }))
    return { ok: false, reason: "an account with that address already exists" };

  const password = generatePassword();
  const user = await prisma.appUser.create({
    data: {
      email, name: input.name?.trim() || null, passwordHash: hashPassword(password),
      role: input.role, status: "ACTIVE", mustChangePassword: true, createdById: actor.userId,
    },
  });
  await audit(actor, "USER_CREATED", `${user.email} as ${user.role}`);
  // Returned once, for the operator to hand over. It is never stored in readable form.
  return { ok: true, detail: `${email} created`, password };
}

export async function changeRole(
  actor: { userId: number; role: string }, userId: number, role: string,
): Promise<UserMutation> {
  const bad = guardRole(actor.role, role);
  if (bad) return { ok: false, reason: bad };
  const target = await prisma.appUser.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, reason: "user not found" };
  const hidden = guardTarget(target.role);
  if (hidden) return { ok: false, reason: hidden };
  if (target.role === "OWNER" && actor.role !== "OWNER")
    return { ok: false, reason: "only an owner can change another owner's role" };
  if (wouldOrphanOwnership(target.role, await ownerCount(), role === "OWNER"))
    return { ok: false, reason: "this is the last owner - promote someone else first" };

  await prisma.appUser.update({ where: { id: userId }, data: { role } });
  await audit(actor, "USER_ROLE_CHANGED", `${target.email}: ${target.role} -> ${role}`);
  return { ok: true, detail: `${target.email} is now ${role}` };
}

export async function setStatus(
  actor: { userId: number; role: string }, userId: number, status: "ACTIVE" | "SUSPENDED",
): Promise<UserMutation> {
  const target = await prisma.appUser.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, reason: "user not found" };
  const hidden = guardTarget(target.role);
  if (hidden) return { ok: false, reason: hidden };
  if (target.id === actor.userId) return { ok: false, reason: "you cannot suspend your own account" };
  if (target.role === "OWNER" && actor.role !== "OWNER")
    return { ok: false, reason: "only an owner can suspend another owner" };
  if (wouldOrphanOwnership(target.role, await ownerCount(), status === "ACTIVE"))
    return { ok: false, reason: "this is the last owner - promote someone else first" };

  await prisma.appUser.update({ where: { id: userId }, data: { status } });
  await audit(actor, status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_REACTIVATED", target.email);
  return { ok: true, detail: `${target.email} is now ${status.toLowerCase()}` };
}

export async function resetPassword(
  actor: { userId: number; role: string }, userId: number,
): Promise<UserMutation> {
  const target = await prisma.appUser.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, reason: "user not found" };
  const hidden = guardTarget(target.role);
  if (hidden) return { ok: false, reason: hidden };
  if (target.role === "OWNER" && actor.role !== "OWNER" && target.id !== actor.userId)
    return { ok: false, reason: "only an owner can reset another owner's password" };

  const password = generatePassword();
  await prisma.appUser.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(password), mustChangePassword: true },
  });
  await audit(actor, "USER_PASSWORD_RESET", target.email);
  return { ok: true, detail: `new password issued for ${target.email}`, password };
}

/** A user changing their own password. Requires the current one even though they are signed in. */
export async function changeOwnPassword(
  userId: number, current: string, next: string,
): Promise<UserMutation> {
  if (next.length < 10) return { ok: false, reason: "use at least 10 characters" };
  const user = await prisma.appUser.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, reason: "user not found" };
  if (!verifyPassword(current, user.passwordHash))
    return { ok: false, reason: "the current password is not correct" };

  await prisma.appUser.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(next), mustChangePassword: false },
  });
  await audit({ userId, role: user.role }, "USER_PASSWORD_CHANGED", user.email);
  return { ok: true, detail: "password changed" };
}

export async function deleteUser(
  actor: { userId: number; role: string }, userId: number,
): Promise<UserMutation> {
  const target = await prisma.appUser.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, reason: "user not found" };
  const hidden = guardTarget(target.role);
  if (hidden) return { ok: false, reason: hidden };
  if (target.id === actor.userId) return { ok: false, reason: "you cannot delete your own account" };
  if (target.role === "OWNER" && actor.role !== "OWNER")
    return { ok: false, reason: "only an owner can remove another owner" };
  if (wouldOrphanOwnership(target.role, await ownerCount(), false))
    return { ok: false, reason: "this is the last owner" };

  await prisma.appUser.delete({ where: { id: userId } });
  // The account goes; what it did stays. Audit rows are never rewritten.
  await audit(actor, "USER_DELETED", target.email);
  return { ok: true, detail: `${target.email} removed` };
}

function ownerCount() {
  return prisma.appUser.count({ where: { role: "OWNER", status: "ACTIVE" } });
}

async function audit(actor: { userId: number; role: string }, eventType: string, detail: string) {
  const user = await prisma.appUser.findUnique({
    where: { id: actor.userId }, select: { email: true } });
  await prisma.auditEvent.create({
    data: { eventType, actor: user?.email ?? "unknown", actorId: actor.userId,
            actorRole: actor.role, detail },
  });
}
