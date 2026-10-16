"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorOf } from "../audit";
import { runBulk, type BulkAction } from "./bulk";
import type { Permission } from "../rbac";

/** Each bulk action carries the permission its single-record equivalent would need. */
const PERMISSION: Record<BulkAction, Permission> = {
  ADD_TO_CAMPAIGN: "campaign.edit",
  SUPPRESS: "suppression.manage",
  MARK_REVIEW: "verification.manage",
  MARK_READY: "verification.manage",
  EXCLUDE: "verification.manage",
};

export async function bulkAction(formData: FormData) {
  const action = String(formData.get("action") ?? "") as BulkAction;
  const back = String(formData.get("back") ?? "/pharmacies");
  const sep = back.includes("?") ? "&" : "?";

  if (!PERMISSION[action]) redirect(`${back}${sep}error=unknown+action`);

  const session = await requirePermission(PERMISSION[action]);
  const ids = String(formData.get("ids") ?? "").split(",").map(Number).filter(Boolean);

  const r = await runBulk(action, ids, {
    campaignId: Number(formData.get("campaignId")) || undefined,
    reason: String(formData.get("reason") ?? ""),
  }, actorOf(session));

  revalidatePath("/pharmacies");
  revalidatePath("/campaigns");
  redirect(r.ok
    ? `${back}${sep}done=${encodeURIComponent(r.detail)}`
    : `${back}${sep}error=${encodeURIComponent(r.reason)}`);
}
