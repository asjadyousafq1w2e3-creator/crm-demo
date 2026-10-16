"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorOf } from "../audit";
import * as service from "./service";

const PERMISSION = "verification.manage" as const;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export async function createBatch(formData: FormData) {
  const session = await requirePermission(PERMISSION);

  const scope = {
    states: formData.getAll("state").map(String).filter(Boolean),
    emailKinds: formData.getAll("emailKind").map(String).filter(Boolean),
    pharmacyTypes: formData.getAll("pharmacyType").map(String).filter(Boolean),
    previousResults: formData.getAll("previousResult").map(String).filter(Boolean),
    onlyUnchecked: formData.get("onlyUnchecked") === "on",
    recheckOlderThanDays: num(formData.get("recheckOlderThanDays")),
    addedWithinDays: num(formData.get("addedWithinDays")),
    importBatchId: num(formData.get("importBatchId")),
    onlyVerifiedRecords: formData.get("onlyVerifiedRecords") === "on",
    excludeContacted: formData.get("excludeContacted") === "on",
    search: String(formData.get("search") ?? ""),
    limit: num(formData.get("limit")),
  };

  const r = await service.createBatch(String(formData.get("name") ?? ""), scope, actorOf(session));
  if (!r.ok) redirect(`/verification/email?error=${encodeURIComponent(r.reason)}`);

  revalidatePath("/verification/email");

  // Say so when addresses were dropped for already being valid. A round that quietly contains
  // fewer addresses than the operator expected is the kind of surprise that erodes trust in
  // the numbers, even when the smaller number is the right one.
  const note = r.skippedValid
    ? `&skipped=${r.skippedValid}` : "";

  // Hand it straight to the verifier when one is configured, so the usual path is one click.
  if (formData.get("submitNow") === "on") {
    const sent = await service.submitToProvider(r.id, actorOf(session));
    if (!sent.ok)
      redirect(`/verification/email/${r.id}?error=${encodeURIComponent(sent.reason)}`);
    redirect(`/verification/email/${r.id}?submitted=1${note}`);
  }
  redirect(`/verification/email/${r.id}?created=1${note}`);
}

export async function submitToProvider(batchId: number) {
  const session = await requirePermission(PERMISSION);
  const r = await service.submitToProvider(batchId, actorOf(session));
  revalidatePath(`/verification/email/${batchId}`);
  redirect(r.ok
    ? `/verification/email/${batchId}?submitted=1`
    : `/verification/email/${batchId}?error=${encodeURIComponent(r.reason)}`);
}

export async function pollProvider(batchId: number) {
  const session = await requirePermission(PERMISSION);
  const r = await service.pollProvider(batchId, actorOf(session));
  revalidatePath(`/verification/email/${batchId}`);
  revalidatePath("/pharmacies");
  redirect(r.ok
    ? `/verification/email/${batchId}?polled=${r.status}${r.applied ? `&applied=${r.applied}` : ""}`
    : `/verification/email/${batchId}?error=${encodeURIComponent(r.reason)}`);
}

export async function applyResults(batchId: number, formData: FormData) {
  const session = await requirePermission(PERMISSION);
  const csv = String(formData.get("results") ?? "");
  if (!csv.trim())
    redirect(`/verification/email/${batchId}?error=paste+the+verifier+results+first`);

  const r = await service.applyResults(batchId, csv, actorOf(session));
  revalidatePath(`/verification/email/${batchId}`);
  revalidatePath("/pharmacies");
  if (!r.ok) redirect(`/verification/email/${batchId}?error=${encodeURIComponent(r.reason)}`);
  redirect(`/verification/email/${batchId}?applied=${r.applied}&unmatched=${r.unmatched}`);
}

export async function cancelBatch(batchId: number) {
  const session = await requirePermission(PERMISSION);
  await service.cancelBatch(batchId, actorOf(session));
  redirect("/verification/email");
}
