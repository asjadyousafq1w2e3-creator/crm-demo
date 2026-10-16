"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorFields, actorOf } from "../audit";
import { prisma } from "../db";
import * as triage from "./triage";
import type { Category } from "./classify";

/** Every triage action returns the operator to the exact list they acted from. */
function back(formData: FormData, extra: string) {
  const to = String(formData.get("back") ?? "/inbox");
  redirect(`${to}${to.includes("?") ? "&" : "?"}${extra}`);
}

export async function setCategory(formData: FormData) {
  const session = await requirePermission("inbox.view");
  const id = Number(formData.get("id"));
  const category = String(formData.get("category")) as Category;
  await triage.setCategory(id, category, session.email);
  await prisma.auditEvent.create({
    data: { eventType: "REPLY_RECATEGORISED", ...actorFields(actorOf(session)),
            detail: `conversation ${id} -> ${category}` } });
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${id}`);
}

export async function assignConversation(formData: FormData) {
  await requirePermission("inbox.view");
  const id = Number(formData.get("id"));
  const raw = String(formData.get("assignedToId") ?? "");
  await triage.assignConversation(id, raw ? Number(raw) : null);
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${id}`);
}

export async function snoozeConversation(formData: FormData) {
  await requirePermission("inbox.view");
  const id = Number(formData.get("id"));
  await triage.snoozeConversation(id, Number(formData.get("days")) || 3);
  back(formData, "done=snoozed");
}

export async function closeConversation(formData: FormData) {
  await requirePermission("inbox.view");
  await triage.closeConversation(Number(formData.get("id")));
  back(formData, "done=closed");
}

export async function reopenConversation(formData: FormData) {
  await requirePermission("inbox.view");
  await triage.reopenConversation(Number(formData.get("id")));
  back(formData, "done=reopened");
}

export async function bulkTriage(formData: FormData) {
  const session = await requirePermission("inbox.view");
  const action = String(formData.get("action")) as triage.BulkAction;
  const ids = String(formData.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  const assignedRaw = String(formData.get("assignedToId") ?? "");

  const r = await triage.runBulk(action, ids, {
    assignedToId: assignedRaw ? Number(assignedRaw) : null,
    days: Number(formData.get("days")) || undefined,
    category: (String(formData.get("category") ?? "") || undefined) as Category | undefined,
    actor: session.email,
  });

  if (r.changed)
    await prisma.auditEvent.create({
      data: { eventType: "INBOX_BULK", ...actorFields(actorOf(session)),
              detail: `${action} on ${r.changed} conversation(s)` } });

  revalidatePath("/inbox");
  back(formData, `done=${encodeURIComponent(r.message)}`);
}
