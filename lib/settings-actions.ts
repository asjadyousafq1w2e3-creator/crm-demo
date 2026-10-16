"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "./auth";
import { actorOf } from "./audit";
import { setSettings } from "./settings";
import { prisma } from "./db";
import { suppress } from "./campaign/suppression";

export async function saveCompanySettings(formData: FormData) {
  const session = await requirePermission("settings.manage");
  await setSettings({
    "company.name": String(formData.get("name") ?? ""),
    "company.address": String(formData.get("address") ?? ""),
    "company.website": String(formData.get("website") ?? ""),
    "company.replyTo": String(formData.get("replyTo") ?? ""),
  }, actorOf(session));
  revalidatePath("/settings");
}

export async function addSuppression(formData: FormData) {
  const session = await requirePermission("suppression.manage");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;
  await suppress(email, String(formData.get("reason") ?? "MANUAL_BLOCK"), session.email,
    String(formData.get("notes") ?? "") || undefined);
  revalidatePath("/settings/suppression");
}

/**
 * Removal is deliberately narrow: an UNSUBSCRIBED entry can never be lifted from the UI, because
 * the person asked not to be contacted and an operator must not be able to undo that with a click.
 */
export async function removeSuppression(id: number) {
  const session = await requirePermission("suppression.manage");
  const entry = await prisma.suppressionEntry.findUnique({ where: { id } });
  if (!entry || entry.reason === "UNSUBSCRIBED") return;
  await prisma.suppressionEntry.delete({ where: { id } });
  await prisma.auditEvent.create({
    data: { eventType: "SUPPRESSION_REMOVED", actor: session.email, actorId: session.userId,
            actorRole: session.role, detail: `${entry.email} (${entry.reason})` } });
  revalidatePath("/settings/suppression");
}

export async function pauseAllCampaigns() {
  const session = await requirePermission("campaign.send");
  const r = await prisma.campaign.updateMany({
    where: { status: "RUNNING" }, data: { status: "PAUSED" } });
  await prisma.auditEvent.create({
    data: { eventType: "EMERGENCY_STOP", actor: session.email, actorId: session.userId,
            actorRole: session.role, detail: `${r.count} running campaign(s) paused` } });
  revalidatePath("/settings");
  revalidatePath("/campaigns");
  return r.count;
}

export async function pauseAllCampaignsForm() {
  await pauseAllCampaigns();
}
