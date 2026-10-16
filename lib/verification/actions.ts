"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorOf } from "../audit";
import { DIMENSIONS, submitVerification, type DimensionSubmission, type DimensionType,
         type Verdict } from "./service";

/**
 * Records a verification and moves to the next record.
 *
 * The filter travels in the querystring so "skip" and "save and next" both land on the next
 * record in the same queue rather than resetting to the top of everything.
 */
export async function recordVerification(pharmacyId: number, formData: FormData) {
  const session = await requirePermission("verification.manage");

  const submissions: DimensionSubmission[] = [];
  for (const d of DIMENSIONS) {
    const verdict = String(formData.get(`verdict_${d.type}`) ?? "").trim();
    if (!verdict) continue;                       // untouched dimensions are left alone
    submissions.push({
      type: d.type as DimensionType,
      verdict: verdict as Verdict,
      value: String(formData.get(`value_${d.type}`) ?? "").trim() || undefined,
      evidenceSource: String(formData.get("evidenceSource") ?? ""),
      evidenceUrl: String(formData.get("evidenceUrl") ?? ""),
      notes: String(formData.get(`notes_${d.type}`) ?? ""),
    });
  }

  const query = String(formData.get("query") ?? "");
  if (!submissions.length)
    redirect(`/verification/work?${query}&error=nothing+was+recorded`);

  const r = await submitVerification(pharmacyId, submissions, actorOf(session));

  // Record-level notes, carried into the deliverable.
  const notes = String(formData.get("recordNotes") ?? "").trim();
  if (notes) {
    const { prisma } = await import("../db");
    await prisma.pharmacy.update({ where: { id: pharmacyId }, data: { notes } });
  }

  revalidatePath("/verification");
  revalidatePath("/verification/work");
  redirect(`/verification/work?${query}&done=${r.pharmacyId}&status=${r.status}`);
}

/** Passes over a record without recording anything, so the queue keeps moving. */
export async function skipRecord(pharmacyId: number, formData: FormData) {
  await requirePermission("verification.manage");
  const query = String(formData.get("query") ?? "");
  const skipped = String(formData.get("skipped") ?? "");
  const next = skipped ? `${skipped},${pharmacyId}` : String(pharmacyId);
  redirect(`/verification/work?${query}&skipped=${next}`);
}
