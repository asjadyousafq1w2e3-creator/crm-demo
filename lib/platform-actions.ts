"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import { resumeSystem, suspendSystem } from "./system-state";
import { config } from "./config";

/**
 * Break-glass controls. Guarded by system.control, which only the platform role holds - an owner
 * or admin who found this path still gets a 403.
 */
export async function suspend(formData: FormData) {
  await requirePermission("system.control");
  await suspendSystem(String(formData.get("reason") ?? ""));
  revalidatePath("/", "layout");
  redirect(`/${config.platform.consolePath}?done=suspended`);
}

export async function resume() {
  await requirePermission("system.control");
  await resumeSystem();
  revalidatePath("/", "layout");
  redirect(`/${config.platform.consolePath}?done=resumed`);
}
