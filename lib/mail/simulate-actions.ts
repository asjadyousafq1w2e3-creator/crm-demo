"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "../auth";
import { simulate, type SimulationKind } from "./simulate";

export async function simulateEvent(campaignId: number, formData: FormData) {
  await requirePermission("campaign.send");
  const recipientId = Number(formData.get("recipientId"));
  const kind = String(formData.get("kind") ?? "REPLY") as SimulationKind;
  if (!recipientId) return;
  await simulate(recipientId, kind);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/inbox");
  revalidatePath("/sender-health");
}
