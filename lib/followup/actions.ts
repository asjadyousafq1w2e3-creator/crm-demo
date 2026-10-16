"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorFields, actorOf } from "../audit";
import { prisma } from "../db";
import * as queue from "./service";
import type { Kind, Priority } from "./service";

function refresh() {
  revalidatePath("/follow-ups");
  revalidatePath("/inbox");
}

function back(formData: FormData, extra: string) {
  const to = String(formData.get("back") ?? "/follow-ups");
  redirect(`${to}${to.includes("?") ? "&" : "?"}${extra}`);
}

/** Due dates are entered as a number of days, which is how people actually think about them. */
function dueFrom(formData: FormData): Date {
  const explicit = String(formData.get("dueDate") ?? "").trim();
  if (explicit) {
    const d = new Date(`${explicit}T09:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const days = Number(formData.get("days")) || 3;
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() + days * 86_400_000);
}

export async function createTask(formData: FormData) {
  const session = await requirePermission("followup.manage");
  const pharmacyId = Number(formData.get("pharmacyId"));
  if (!pharmacyId) back(formData, "error=no+pharmacy");

  const assigned = String(formData.get("assignedToId") ?? "");
  await queue.createTask({
    pharmacyId,
    conversationId: Number(formData.get("conversationId")) || null,
    dueAt: dueFrom(formData),
    kind: (String(formData.get("kind") ?? "EMAIL") || "EMAIL") as Kind,
    priority: (String(formData.get("priority") ?? "NORMAL") || "NORMAL") as Priority,
    note: String(formData.get("note") ?? ""),
    assignedToId: assigned ? Number(assigned) : null,
    createdBy: session.email,
  });
  refresh();
  back(formData, "done=task+created");
}

export async function snoozeTask(formData: FormData) {
  await requirePermission("followup.manage");
  const id = Number(formData.get("id"));
  const t = await queue.snooze(id, Number(formData.get("days")) || 3);
  refresh();
  back(formData, `done=pushed+to+${t.dueAt.toISOString().slice(0, 10)}`);
}

export async function completeTask(formData: FormData) {
  const session = await requirePermission("followup.manage");
  const id = Number(formData.get("id"));
  const t = await queue.complete(id, String(formData.get("outcome") ?? ""));
  await prisma.auditEvent.create({
    data: { eventType: "FOLLOWUP_COMPLETED", pharmacyId: t.pharmacyId,
            ...actorFields(actorOf(session)), detail: t.outcome ?? undefined } });
  refresh();
  back(formData, "done=done");
}

export async function cancelTask(formData: FormData) {
  await requirePermission("followup.manage");
  await queue.cancel(Number(formData.get("id")), String(formData.get("outcome") ?? ""));
  refresh();
  back(formData, "done=cancelled");
}

export async function assignTask(formData: FormData) {
  await requirePermission("followup.manage");
  const raw = String(formData.get("assignedToId") ?? "");
  await queue.assign(Number(formData.get("id")), raw ? Number(raw) : null);
  refresh();
  back(formData, "done=assigned");
}

/** Clearing a day's work one row at a time is the thing people stop doing. */
export async function bulkTasks(formData: FormData) {
  const session = await requirePermission("followup.manage");
  const ids = String(formData.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  const action = String(formData.get("bulk") ?? "");
  if (!ids.length) back(formData, "error=nothing+selected");

  let message = "";
  if (action === "COMPLETE") {
    const { count } = await prisma.followUp.updateMany({
      where: { id: { in: ids } },
      data: { status: "COMPLETED", completedAt: new Date() } });
    message = `${count} marked done`;
  } else if (action === "SNOOZE") {
    const days = Number(formData.get("days")) || 3;
    const base = new Date(); base.setHours(9, 0, 0, 0);
    const { count } = await prisma.followUp.updateMany({
      where: { id: { in: ids } },
      data: { dueAt: new Date(base.getTime() + days * 86_400_000), status: "PENDING",
              snoozeCount: { increment: 1 } } });
    message = `${count} pushed back ${days} days`;
  } else if (action === "ASSIGN") {
    const raw = String(formData.get("assignedToId") ?? "");
    const { count } = await prisma.followUp.updateMany({
      where: { id: { in: ids } }, data: { assignedToId: raw ? Number(raw) : null } });
    message = `${count} reassigned`;
  } else if (action === "CANCEL") {
    const { count } = await prisma.followUp.updateMany({
      where: { id: { in: ids } },
      data: { status: "CANCELLED", completedAt: new Date() } });
    message = `${count} cancelled`;
  } else {
    back(formData, "error=unknown+action");
  }

  await prisma.auditEvent.create({
    data: { eventType: "FOLLOWUP_BULK", ...actorFields(actorOf(session)), detail: message } });
  refresh();
  back(formData, `done=${encodeURIComponent(message)}`);
}
