/**
 * Acting on many records at once.
 *
 * Every action here is one an operator could do record by record; doing a thousand at a time is
 * the only difference. So each is audited with its count and its reason, and none can reach a
 * record the caller did not select.
 */
import { prisma } from "../db";
import { actorFields, type Actor } from "../audit";
import { suppress } from "../campaign/suppression";

export type BulkAction =
  | "ADD_TO_CAMPAIGN" | "SUPPRESS" | "MARK_REVIEW" | "MARK_READY" | "EXCLUDE";

export type BulkResult = { ok: true; affected: number; detail: string }
                       | { ok: false; reason: string };

export async function runBulk(
  action: BulkAction, ids: number[], options: { campaignId?: number; reason?: string },
  actor: Actor,
): Promise<BulkResult> {
  if (!ids.length) return { ok: false, reason: "nothing was selected" };

  const records = await prisma.pharmacy.findMany({
    where: { id: { in: ids } },
    select: { id: true, canonicalName: true, email: true, verificationStatus: true },
  });
  if (!records.length) return { ok: false, reason: "none of those records exist" };
  const selected = records.map((r) => r.id);

  switch (action) {
    case "ADD_TO_CAMPAIGN": {
      if (!options.campaignId) return { ok: false, reason: "choose a campaign" };
      const campaign = await prisma.campaign.findUnique({ where: { id: options.campaignId } });
      if (!campaign) return { ok: false, reason: "campaign not found" };
      if (["COMPLETED", "CANCELLED"].includes(campaign.status))
        return { ok: false, reason: `that campaign is ${campaign.status.toLowerCase()}` };

      // Reuse the campaign service so eligibility is decided in exactly one place. A bulk add
      // that skipped it would be a way of mailing records the rules exclude.
      const { buildRecipients } = await import("../campaign/service");
      const r = await buildRecipients(campaign.id, { id: { in: selected } }, actor);
      await audit(actor, "BULK_ADDED_TO_CAMPAIGN",
        `${campaign.name}: ${r.eligible} eligible, ${r.blocked} blocked of ${records.length}`);
      return { ok: true, affected: r.eligible,
               detail: `${r.eligible} added to ${campaign.name}`
                       + (r.blocked ? `; ${r.blocked} blocked by eligibility` : "") };
    }

    case "SUPPRESS": {
      const withEmail = records.filter((r) => r.email);
      for (const r of withEmail)
        await suppress(r.email!, "MANUAL_BLOCK", actor.email, options.reason || "bulk suppression");
      await audit(actor, "BULK_SUPPRESSED",
        `${withEmail.length} addresses${options.reason ? `: ${options.reason}` : ""}`);
      return { ok: true, affected: withEmail.length,
               detail: `${withEmail.length} address(es) suppressed permanently`
                       + (records.length - withEmail.length
                          ? `; ${records.length - withEmail.length} had no address` : "") };
    }

    case "MARK_REVIEW": {
      const r = await prisma.pharmacy.updateMany({
        where: { id: { in: selected } },
        data: { verificationStatus: "NEEDS_REVIEW",
                exclusionReason: options.reason?.trim() || "sent to review by an operator" },
      });
      await audit(actor, "BULK_MARKED_REVIEW", `${r.count} records`);
      return { ok: true, affected: r.count, detail: `${r.count} sent to review` };
    }

    case "MARK_READY": {
      // Deliberately cannot touch an EXCLUDED record: undoing an exclusion is a decision that
      // belongs on the record itself, with the reason in front of you.
      const r = await prisma.pharmacy.updateMany({
        where: { id: { in: selected }, verificationStatus: "NEEDS_REVIEW" },
        data: { verificationStatus: "READY_FOR_VERIFICATION", exclusionReason: null },
      });
      await audit(actor, "BULK_MARKED_READY", `${r.count} records`);
      return { ok: true, affected: r.count,
               detail: `${r.count} returned to the verification queue`
                       + (records.length - r.count
                          ? `; ${records.length - r.count} were not in review` : "") };
    }

    case "EXCLUDE": {
      if (!options.reason?.trim())
        return { ok: false, reason: "an exclusion needs a reason — it goes on the record" };
      const r = await prisma.pharmacy.updateMany({
        where: { id: { in: selected } },
        data: { verificationStatus: "EXCLUDED", campaignEligible: false,
                exclusionReason: `operator: ${options.reason.trim()}`.slice(0, 400) },
      });
      await audit(actor, "BULK_EXCLUDED", `${r.count} records: ${options.reason.trim()}`);
      return { ok: true, affected: r.count, detail: `${r.count} excluded from every campaign` };
    }
  }
}

async function audit(actor: Actor, eventType: string, detail: string) {
  await prisma.auditEvent.create({ data: { eventType, detail, ...actorFields(actor) } });
}
