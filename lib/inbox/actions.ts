"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorOf } from "../audit";
import * as service from "./service";
import type { LeadStatus } from "./service";

export async function sendReply(conversationId: number, formData: FormData) {
  const session = await requirePermission("inbox.reply");
  const r = await service.replyToConversation(
    conversationId, String(formData.get("body") ?? ""), actorOf(session));
  revalidatePath(`/inbox/${conversationId}`);
  revalidatePath("/inbox");
  return r;
}

/** Form wrapper: forms need a void action, so the outcome is reported through the querystring. */
export async function sendReplyForm(conversationId: number, formData: FormData) {
  const r = await sendReply(conversationId, formData);
  redirect(r.ok ? `/inbox/${conversationId}?sent=1`
                : `/inbox/${conversationId}?error=${encodeURIComponent(r.reason)}`);
}

export async function setLeadStatus(pharmacyId: number, status: LeadStatus) {
  const session = await requirePermission("registry.edit");
  await service.setLeadStatus(pharmacyId, status, undefined, actorOf(session));
  revalidatePath("/inbox");
  revalidatePath("/follow-ups");
  revalidatePath(`/pharmacies/${pharmacyId}`);
}

export async function markRead(conversationId: number, unread = false) {
  await requirePermission("inbox.view");
  await service.markRead(conversationId, unread);
  revalidatePath("/inbox");
}

export async function scheduleFollowUp(formData: FormData) {
  const session = await requirePermission("followup.manage");
  const pharmacyId = Number(formData.get("pharmacyId"));
  const due = String(formData.get("dueAt") ?? "");
  const conversationId = formData.get("conversationId")
    ? Number(formData.get("conversationId")) : undefined;
  if (!pharmacyId || !due) return;
  await service.scheduleFollowUp(pharmacyId, new Date(`${due}T09:00:00`),
    String(formData.get("note") ?? "") || undefined, conversationId, actorOf(session));
  revalidatePath("/follow-ups");
  if (conversationId) revalidatePath(`/inbox/${conversationId}`);
}

export async function closeFollowUp(id: number, status: "COMPLETED" | "CANCELLED") {
  const session = await requirePermission("followup.manage");
  await service.closeFollowUp(id, status, actorOf(session));
  revalidatePath("/follow-ups");
}
