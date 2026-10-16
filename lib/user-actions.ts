"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireSession } from "./auth";
import * as users from "./users";

/**
 * Operator administration. Every one of these re-checks the permission server-side, so a crafted
 * POST from a viewer's browser is refused exactly as the hidden button would have been.
 *
 * Generated passwords come back through the querystring once, for the admin to hand over. They
 * are never stored in readable form and never emailed by the app.
 */
const back = (r: users.UserMutation) =>
  redirect(r.ok
    ? `/settings/users?ok=${encodeURIComponent(r.detail)}${r.password ? `&pw=${encodeURIComponent(r.password)}` : ""}`
    : `/settings/users?error=${encodeURIComponent(r.reason)}`);

export async function createUser(formData: FormData) {
  const session = await requirePermission("users.manage");
  back(await users.createUser(session, {
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") ?? "VIEWER"),
  }));
}

export async function changeRole(userId: number, formData: FormData) {
  const session = await requirePermission("users.manage");
  back(await users.changeRole(session, userId, String(formData.get("role") ?? "")));
}

export async function setStatus(userId: number, status: "ACTIVE" | "SUSPENDED") {
  const session = await requirePermission("users.manage");
  back(await users.setStatus(session, userId, status));
}

export async function resetPassword(userId: number) {
  const session = await requirePermission("users.manage");
  back(await users.resetPassword(session, userId));
}

export async function deleteUser(userId: number) {
  const session = await requirePermission("users.manage");
  back(await users.deleteUser(session, userId));
}

/** Anyone signed in may change their own password; it needs the current one regardless. */
export async function changeOwnPassword(formData: FormData) {
  const session = await requireSession();
  const r = await users.changeOwnPassword(
    session.userId,
    String(formData.get("current") ?? ""),
    String(formData.get("next") ?? ""));
  revalidatePath("/account");
  redirect(r.ok ? "/account?ok=password+changed"
                : `/account?error=${encodeURIComponent(r.reason)}`);
}
