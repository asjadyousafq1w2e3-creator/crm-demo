"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { requirePermission } from "../auth";
import { actorFields, actorOf } from "../audit";
import { syncMailbox, syncAllMailboxes } from "./sync";
import { config } from "../config";
import { isValidTimeOfDay, isValidTimezone } from "../campaign/schedule";

export async function setMailboxStatus(id: number, status: "PAUSED" | "CONNECTED") {
  const session = await requirePermission("mailbox.manage");
  await prisma.mailbox.update({ where: { id }, data: { status } });
  await prisma.auditEvent.create({
    data: { eventType: status === "PAUSED" ? "MAILBOX_PAUSED" : "MAILBOX_RESUMED",
            ...actorFields(actorOf(session)) } });
  revalidatePath("/settings/mailboxes");
}

export async function disconnectMailbox(id: number) {
  const session = await requirePermission("mailbox.manage");
  // Drop the refresh token rather than keeping a credential we no longer use.
  await prisma.mailbox.update({
    where: { id },
    data: { status: "DISCONNECTED", encryptedRefreshToken: null, gmailHistoryId: null },
  });
  await prisma.auditEvent.create({
    data: { eventType: "MAILBOX_DISCONNECTED", ...actorFields(actorOf(session)) } });
  revalidatePath("/settings/mailboxes");
}

const RAMP_STAGES = ["NEW", "RAMPING", "ESTABLISHED", "MANUAL"];

export async function updateMailboxLimits(formData: FormData) {
  const session = await requirePermission("mailbox.manage");
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;

  // Validated rather than trusted: these values are read by the router on every send, and an
  // unknown timezone or a malformed window would misbehave quietly for as long as it sat there.
  const dailyLimit = Number(formData.get("dailyLimit") ?? config.limits.defaultMailboxDaily);
  const rampStage = String(formData.get("rampStage") ?? "NEW");
  const start = String(formData.get("sendingStartTime") ?? config.schedule.start);
  const end = String(formData.get("sendingEndTime") ?? config.schedule.end);
  const timezone = String(formData.get("timezone") ?? config.schedule.timezone);

  const problems: string[] = [];
  if (!Number.isFinite(dailyLimit) || dailyLimit < 1 || dailyLimit > 2000)
    problems.push("the daily limit must be between 1 and 2,000");
  if (!RAMP_STAGES.includes(rampStage)) problems.push(`"${rampStage}" is not a ramp stage`);
  if (!isValidTimeOfDay(start) || !isValidTimeOfDay(end))
    problems.push("sending times must look like 09:00");
  else if (start >= end) problems.push("the sending window must start before it ends");
  if (!isValidTimezone(timezone)) problems.push(`"${timezone}" is not a known timezone`);

  if (problems.length) {
    redirect(`/settings/mailboxes?error=${encodeURIComponent(problems.join("; "))}`);
  }

  await prisma.mailbox.update({
    where: { id },
    data: { dailyLimit, rampStage, sendingStartTime: start, sendingEndTime: end, timezone },
  });
  await prisma.auditEvent.create({
    data: { eventType: "MAILBOX_LIMITS_CHANGED",
            detail: `mailbox ${id}: ${formData.get("dailyLimit")}/day, ramp ` +
                    `${formData.get("rampStage")}, ${formData.get("sendingStartTime")}-` +
                    `${formData.get("sendingEndTime")} ${formData.get("timezone")}`,
            ...actorFields(actorOf(session)) } });
  revalidatePath("/settings/mailboxes");
}

export async function addMockMailbox(formData: FormData) {
  const session = await requirePermission("mailbox.manage");
  const address = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!address) return;
  await prisma.mailbox.upsert({
    where: { emailAddress: address }, update: { status: "CONNECTED", provider: "mock" },
    create: {
      provider: "mock", emailAddress: address, displayName: String(formData.get("name") ?? ""),
      domain: address.split("@")[1] ?? null, status: "CONNECTED", healthStatus: "HEALTHY",
      rampStage: "MANUAL", dailyLimit: config.limits.defaultMailboxDaily,
      sendingStartTime: "00:00", sendingEndTime: "23:59",
      timezone: config.schedule.timezone, connectedAt: new Date(),
    },
  });
  await prisma.auditEvent.create({
    data: { eventType: "MAILBOX_CONNECTED", detail: `${address} (mock)`,
            ...actorFields(actorOf(session)) } });
  revalidatePath("/settings/mailboxes");
}

export async function syncNow(id?: number) {
  const session = await requirePermission("mailbox.manage");
  const r = id ? await syncMailbox(id) : await syncAllMailboxes();
  await prisma.auditEvent.create({
    data: { eventType: "INBOX_SYNCED", detail: `${r.newMessages} new message(s)`,
            ...actorFields(actorOf(session)) } });
  revalidatePath("/inbox");
  return r;
}

/** Form-action wrapper: forms need a void-returning action. */
export async function syncNowForm(id?: number) {
  await syncNow(id);
}
