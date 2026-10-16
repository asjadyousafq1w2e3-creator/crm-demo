"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { builtIn, noteTemplateUse } from "./templates";
import { requirePermission } from "../auth";
import { actorOf } from "../audit";
import { config } from "../config";
import * as service from "./service";
import { isValidSendingDays, isValidTimeOfDay, isValidTimezone } from "./schedule";

/**
 * Server actions. Each one authorises, then delegates to the service layer - no business logic
 * lives here, so the rules stay testable without a request scope.
 *
 * Authorisation is by permission, not by role, and it happens here rather than in the UI: hiding
 * a button is a courtesy, this is the control.
 */
export async function buildRecipients(campaignId: number, where: Record<string, unknown>) {
  const session = await requirePermission("campaign.edit");
  const r = await service.buildRecipients(campaignId, where, actorOf(session));
  revalidatePath(`/campaigns/${campaignId}`);
  return r;
}

export async function startCampaign(campaignId: number) {
  // The permission that actually puts mail in flight. Deliberately separate from campaign.edit.
  const session = await requirePermission("campaign.send");
  const r = await service.startCampaign(campaignId, actorOf(session));
  revalidatePath(`/campaigns/${campaignId}`);
  // A refusal has to be visible. Returning it silently to a form action means the operator
  // presses start, nothing happens, and they press it again.
  if (r.refused) redirect(`/campaigns/${campaignId}?error=${encodeURIComponent(r.refused)}`);
  return r;
}

export async function setCampaignStatus(
  campaignId: number, status: "PAUSED" | "RUNNING" | "CANCELLED") {
  const session = await requirePermission("campaign.send");
  await service.setCampaignStatus(campaignId, status, actorOf(session));
  revalidatePath(`/campaigns/${campaignId}`);
}

/**
 * Builds a recipient list from a filter.
 *
 * The filter narrows; eligibility still decides. A pharmacy the filter selects but the rules
 * exclude lands as BLOCKED with its reason, rather than being quietly dropped - the operator
 * needs to see that their 1,200 matches produced 0 recipients, and why.
 */
export async function buildAudience(campaignId: number, formData: FormData) {
  const session = await requirePermission("campaign.edit");
  const { audienceWhere } = await import("./audience");

  const filter = {
    states: formData.getAll("state").map(String).filter(Boolean),
    pharmacyTypes: formData.getAll("pharmacyType").map(String).filter(Boolean),
    emailKinds: formData.getAll("emailKind").map(String).filter(Boolean),
    excludeContacted: formData.get("excludeContacted") === "on",
    search: String(formData.get("search") ?? ""),
    limit: Number(formData.get("limit")) || undefined,
  };

  const r = await service.buildRecipients(
    campaignId, audienceWhere(filter) as Record<string, unknown>, actorOf(session), filter.limit);
  revalidatePath(`/campaigns/${campaignId}`);
  // Reported through the querystring: a form action has to return void.
  redirect(`/campaigns/${campaignId}?built=${r.eligible}&blocked=${r.blocked}&kept=${r.kept}`);
}

export async function setCampaignPool(campaignId: number, formData: FormData) {
  const session = await requirePermission("campaign.edit");
  // Unchecked boxes are simply absent from the form, so an empty selection is meaningful:
  // it restores "any eligible mailbox" rather than meaning "nothing was submitted".
  const ids = formData.getAll("mailboxId").map(Number).filter(Number.isFinite);
  await service.setCampaignPool(campaignId, ids, actorOf(session));
  await service.setUseAssignedMailbox(
    campaignId, formData.get("useAssignedMailbox") === "on", actorOf(session));
  revalidatePath(`/campaigns/${campaignId}`);
}

export async function campaignReview(campaignId: number) {
  await requirePermission("campaign.view");
  return service.campaignReview(campaignId);
}

export async function createCampaign(formData: FormData) {
  const session = await requirePermission("campaign.edit");

  // Schedule values are validated here rather than trusted from the form: a bad timezone or a
  // malformed window reaches Intl on every worker tick, and a campaign row is long-lived.
  const timezone = String(formData.get("timezone") ?? config.schedule.timezone);
  const start = String(formData.get("sendingStartTime") ?? config.schedule.start);
  const end = String(formData.get("sendingEndTime") ?? config.schedule.end);
  const days = String(formData.get("sendingDays") ?? "1,2,3,4,5");
  const name = String(formData.get("name") ?? "").trim() || "Untitled campaign";
  const subject = String(formData.get("subject") ?? "").trim();
  const bodyText = String(formData.get("bodyText") ?? "").trim();

  const problems: string[] = [];
  if (!subject) problems.push("a subject is required");
  if (!bodyText) problems.push("a message body is required");
  if (!isValidTimezone(timezone)) problems.push(`"${timezone}" is not a known timezone`);
  if (!isValidTimeOfDay(start) || !isValidTimeOfDay(end))
    problems.push("sending times must look like 09:00");
  else if (start >= end) problems.push("the sending window must start before it ends");
  if (!isValidSendingDays(days)) problems.push("pick at least one sending day");

  const dailyLimit = Number(formData.get("dailyLimit") ?? 100);
  if (!Number.isFinite(dailyLimit) || dailyLimit < 1 || dailyLimit > 10_000)
    problems.push("the daily limit must be between 1 and 10,000");

  if (problems.length)
    redirect(`/campaigns/new?error=${encodeURIComponent(problems.join("; "))}`);

  const c = await prisma.campaign.create({
    data: {
      name, subject, bodyText,
      bodyHtml: String(formData.get("bodyHtml") || bodyText).replace(/\n/g, "<br>"),
      signature: String(formData.get("signature") ?? "").trim() || null,
      timezone, sendingDays: days, sendingStartTime: start, sendingEndTime: end,
      dailyLimit,
    },
  });
  // A template is a whole sequence, not just an opening message, so the follow-ups come with it.
  // They are ordinary CampaignStep rows from this point on - editable, switch-off-able, and with
  // no memory of having come from a template.
  const templateId = String(formData.get("templateId") ?? "").trim();
  let stepsCreated = 0;
  if (templateId) {
    const template = builtIn(templateId);
    if (template?.followUps.length) {
      await prisma.campaignStep.createMany({
        data: template.followUps.map((f, i) => ({
          campaignId: c.id,
          stepNumber: i + 2,               // step 1 is the campaign's own message
          waitDays: f.waitDays,
          subject: f.subject?.trim() || null,
          bodyText: f.bodyText,
          bodyHtml: f.bodyText.split(/\n{2,}/)
            .map((b) => `<p>${b.replace(/\n/g, "<br/>")}</p>`).join("\n"),
        })),
      });
      stepsCreated = template.followUps.length;
    }
    await noteTemplateUse(templateId);
  }

  // Saved under the campaign's own name, because that is what the operator just decided to call
  // this wording. A repeat name updates rather than accumulating near-duplicates.
  if (formData.get("saveAsTemplate") === "on") {
    await prisma.emailTemplate.upsert({
      where: { name },
      update: { subject, bodyText, bodyHtml: c.bodyHtml, kind: "CAMPAIGN" },
      create: { name, kind: "CAMPAIGN", subject, bodyText, bodyHtml: c.bodyHtml,
                purpose: "Saved from a campaign.", createdBy: session.email },
    });
  }

  await prisma.auditEvent.create({
    data: { eventType: "CAMPAIGN_CREATED", actor: session.email, actorId: session.userId,
            actorRole: session.role,
            detail: `${c.name}${templateId ? ` (from template "${templateId}")` : ""}${
              stepsCreated ? `, ${stepsCreated} follow-up step(s)` : ""}` } });
  redirect(`/campaigns/${c.id}${stepsCreated ? "?tab=sequence" : ""}`);
}
