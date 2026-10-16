"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorFields, actorOf } from "../audit";
import { prisma } from "../db";
import { MAX_STEPS, validateSteps } from "./sequence";

/** Editing a running campaign's sequence is allowed; editing a step already sent is not. */
async function assertEditable(campaignId: number, stepNumber?: number) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId }, select: { status: true } });
  if (!campaign) return "That campaign does not exist.";
  if (["COMPLETED", "CANCELLED"].includes(campaign.status))
    return "A finished campaign cannot be changed.";
  if (stepNumber) {
    const sent = await prisma.campaignRecipientStep.count({
      where: { stepNumber, status: "SENT", recipient: { campaignId } } });
    if (sent)
      return `Step ${stepNumber} has already gone to ${sent} recipient(s). `
           + "Rewriting it now would mean two different messages under one label - "
           + "turn it off and add a new step instead.";
  }
  return null;
}

function back(campaignId: number, extra: string) {
  redirect(`/campaigns/${campaignId}?tab=sequence&${extra}`);
}

export async function addStep(formData: FormData) {
  const session = await requirePermission("campaign.edit");
  const campaignId = Number(formData.get("campaignId"));
  const problem = await assertEditable(campaignId);
  if (problem) back(campaignId, `error=${encodeURIComponent(problem)}`);

  const existing = await prisma.campaignStep.findMany({
    where: { campaignId }, orderBy: { stepNumber: "desc" }, take: 1 });
  const stepNumber = (existing[0]?.stepNumber ?? 1) + 1;
  if (stepNumber > MAX_STEPS)
    back(campaignId, `error=${encodeURIComponent(`A sequence may have at most ${MAX_STEPS} steps.`)}`);

  const bodyText = String(formData.get("bodyText") ?? "").trim();
  const waitDays = Number(formData.get("waitDays")) || 3;

  const problems = validateSteps([{ stepNumber, waitDays, bodyText, bodyHtml: bodyText }]);
  if (problems.length)
    back(campaignId, `error=${encodeURIComponent(problems[0].message)}`);

  await prisma.campaignStep.create({
    data: {
      campaignId, stepNumber, waitDays,
      subject: String(formData.get("subject") ?? "").trim() || null,
      bodyText,
      bodyHtml: bodyText.split(/\n{2,}/).map((b) =>
        `<p>${b.replace(/\n/g, "<br/>")}</p>`).join("\n"),
    },
  });
  await prisma.auditEvent.create({
    data: { eventType: "CAMPAIGN_STEP_ADDED", ...actorFields(actorOf(session)),
            detail: `campaign ${campaignId} step ${stepNumber}, +${waitDays}d` } });

  revalidatePath(`/campaigns/${campaignId}`);
  back(campaignId, `done=${encodeURIComponent(`Step ${stepNumber} added.`)}`);
}

export async function updateStep(formData: FormData) {
  const session = await requirePermission("campaign.edit");
  const id = Number(formData.get("id"));
  const step = await prisma.campaignStep.findUnique({ where: { id } });
  if (!step) redirect("/campaigns");

  const problem = await assertEditable(step.campaignId, step.stepNumber);
  if (problem) back(step.campaignId, `error=${encodeURIComponent(problem)}`);

  const bodyText = String(formData.get("bodyText") ?? "").trim();
  const waitDays = Number(formData.get("waitDays")) || step.waitDays;
  const problems = validateSteps([
    { stepNumber: step.stepNumber, waitDays, bodyText, bodyHtml: bodyText }]);
  if (problems.length) back(step.campaignId, `error=${encodeURIComponent(problems[0].message)}`);

  await prisma.campaignStep.update({
    where: { id },
    data: {
      waitDays, bodyText,
      subject: String(formData.get("subject") ?? "").trim() || null,
      bodyHtml: bodyText.split(/\n{2,}/).map((b) =>
        `<p>${b.replace(/\n/g, "<br/>")}</p>`).join("\n"),
    },
  });
  await prisma.auditEvent.create({
    data: { eventType: "CAMPAIGN_STEP_EDITED", ...actorFields(actorOf(session)),
            detail: `campaign ${step.campaignId} step ${step.stepNumber}` } });

  revalidatePath(`/campaigns/${step.campaignId}`);
  back(step.campaignId, `done=${encodeURIComponent(`Step ${step.stepNumber} saved.`)}`);
}

/**
 * Turning a step off rather than deleting it.
 *
 * A deleted step takes its history with it, and "why did this pharmacy get three emails" then
 * has no answer. Off is reversible and keeps the record.
 */
export async function toggleStep(formData: FormData) {
  const session = await requirePermission("campaign.edit");
  const id = Number(formData.get("id"));
  const step = await prisma.campaignStep.findUnique({ where: { id } });
  if (!step) redirect("/campaigns");

  await prisma.campaignStep.update({ where: { id }, data: { active: !step.active } });
  await prisma.auditEvent.create({
    data: { eventType: "CAMPAIGN_STEP_TOGGLED", ...actorFields(actorOf(session)),
            detail: `campaign ${step.campaignId} step ${step.stepNumber} -> ${
              step.active ? "off" : "on"}` } });

  revalidatePath(`/campaigns/${step.campaignId}`);
  back(step.campaignId,
       `done=${encodeURIComponent(`Step ${step.stepNumber} turned ${step.active ? "off" : "on"}.`)}`);
}
