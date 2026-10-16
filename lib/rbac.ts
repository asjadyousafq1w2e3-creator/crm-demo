/**
 * Role-based access control.
 *
 * Permissions are the unit of authorisation, not roles: code asks "may this session send a
 * campaign", never "is this session an admin". Adding a role is then a table edit rather than a
 * hunt through call sites.
 *
 * This module is pure so the whole matrix is testable without a database or a request.
 */
/** Roles an operator can be given, and the only ones the operator screens ever show. */
export const ROLES = ["OWNER", "ADMIN", "MANAGER", "AGENT", "VIEWER"] as const;

/**
 * Roles that exist but are never offered, listed or assignable through the application.
 *
 * PLATFORM is the break-glass account: it is provisioned from the environment, excluded from the
 * operator list, and is the only role that can suspend the CRM. Hiding it is a courtesy to keep
 * it out of an operator's way - the control is the permission check, not the absence of a link.
 */
export const HIDDEN_ROLES = ["PLATFORM"] as const;

export type Role = (typeof ROLES)[number] | (typeof HIDDEN_ROLES)[number];
export const ALL_ROLES: readonly Role[] = [...ROLES, ...HIDDEN_ROLES];

export const PERMISSIONS = [
  "registry.view",        // dashboard, pharmacy list and detail
  "registry.edit",        // lead status, record-level edits
  "verification.manage",  // work the verification queue
  "campaign.view",
  "campaign.edit",        // create, edit, build recipient lists
  "campaign.send",        // start / resume / cancel - the one that puts mail in flight
  "inbox.view",
  "inbox.reply",
  "followup.manage",
  "mailbox.manage",       // connect, pause, limits, ramp stage
  "suppression.manage",
  "settings.manage",      // company details, safety controls
  "users.manage",         // create operators, change roles, suspend
  "audit.view",
  // Suspending and resuming the whole application. Held by PLATFORM alone.
  "system.control",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What each role may do. Deliberately explicit - no inheritance chain to reason about. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Everything, including the controls that take the application offline.
  PLATFORM: PERMISSIONS,

  // Full control of the CRM itself, including who else has access. There is always at least one.
  // Explicitly not system.control: suspending the application is not an operator's decision.
  OWNER: PERMISSIONS.filter((p) => p !== "system.control"),

  // The same permissions as an owner. The difference is enforced where it matters rather than
  // in this table: an admin cannot create or modify an OWNER account (see assignableRoles).
  ADMIN: PERMISSIONS.filter((p) => p !== "system.control"),

  // Runs outreach day to day. No mailbox credentials, no settings, no user administration.
  MANAGER: [
    "registry.view", "registry.edit", "verification.manage",
    "campaign.view", "campaign.edit", "campaign.send",
    "inbox.view", "inbox.reply", "followup.manage",
    "suppression.manage", "audit.view",
  ],

  // Works replies and follow-ups. Can read campaigns but cannot put mail in flight.
  AGENT: [
    "registry.view", "registry.edit",
    "campaign.view", "inbox.view", "inbox.reply", "followup.manage",
  ],

  // Read-only.
  VIEWER: ["registry.view", "campaign.view", "inbox.view", "audit.view"],
};

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner", ADMIN: "Admin", MANAGER: "Campaign manager",
  AGENT: "Agent", VIEWER: "Viewer",
  // Deliberately unremarkable wherever it has to be rendered.
  PLATFORM: "Platform",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  PLATFORM: "Platform maintenance access.",
  OWNER: "Full control, including operator accounts and roles. There must always be one.",
  ADMIN: "Everything an owner can do, including managing other operators.",
  MANAGER: "Runs campaigns and outreach. No mailbox credentials, settings or user administration.",
  AGENT: "Handles replies and follow-ups. Can read campaigns but cannot start a send.",
  VIEWER: "Read-only access to the registry, campaigns, inbox and audit log.",
};

export function isRole(value: string): value is Role {
  return (ALL_ROLES as readonly string[]).includes(value);
}

/** A role an operator may be given through the UI. PLATFORM never qualifies. */
export function isAssignableRole(value: string): value is (typeof ROLES)[number] {
  return (ROLES as readonly string[]).includes(value);
}

export function isHiddenRole(value: string): boolean {
  return (HIDDEN_ROLES as readonly string[]).includes(value);
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!role || !isRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: string): readonly Permission[] {
  return isRole(role) ? ROLE_PERMISSIONS[role] : [];
}

/**
 * Which roles a given role may assign. Only an OWNER can mint another OWNER, so an admin
 * cannot quietly promote themselves past the account that pays for the system.
 */
export function assignableRoles(actorRole: string): Role[] {
  // PLATFORM is never in this list for anybody, including itself: it is provisioned from the
  // environment, so handing it out through a form would be a second, weaker way in.
  if (actorRole === "PLATFORM" || actorRole === "OWNER") return [...ROLES];
  if (actorRole === "ADMIN") return ROLES.filter((r) => r !== "OWNER");
  return [];
}
