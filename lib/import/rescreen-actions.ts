"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorOf } from "../audit";
import { rescreenRegistry, applyRescreen } from "./rescreen";

export async function applyRescreenAction(formData: FormData) {
  const session = await requirePermission("verification.manage");
  const report = await rescreenRegistry();
  const r = await applyRescreen(report,
    { applyReview: formData.get("applyReview") === "on" }, actorOf(session));

  revalidatePath("/", "layout");
  redirect(`/data/rescreen?excluded=${r.excluded}&flagged=${r.flagged}`);
}
