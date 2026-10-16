"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "../auth";
import { actorOf } from "../audit";
import * as service from "./service";
import type { Mapping } from "./engine";
import { FIELDS } from "./fields";

/** Importing rewrites the registry, so it sits behind the same permission as verification work. */
const PERMISSION = "verification.manage" as const;

export async function declareJob(formData: FormData) {
  const session = await requirePermission(PERMISSION);

  const columns = String(formData.get("columns") ?? "")
    .split(/[\n,]+/).map((c) => c.trim()).filter(Boolean);

  const mapping: Mapping = {};
  for (const f of FIELDS) {
    const chosen = String(formData.get(`map_${f.field}`) ?? "").trim();
    if (chosen) mapping[f.field] = chosen;
  }

  const r = await service.declareJob({
    name: String(formData.get("name") ?? ""),
    sourceType: String(formData.get("sourceType") ?? "STATE_BOARD"),
    jurisdiction: String(formData.get("jurisdiction") ?? ""),
    datasetDate: String(formData.get("datasetDate") ?? ""),
    columns, mapping,
  }, actorOf(session));

  if (!r.ok) redirect(`/data/import/new?error=${encodeURIComponent(r.reason)}`);
  redirect(`/data/import/${r.value}`);
}

export async function analyse(jobId: number) {
  const session = await requirePermission(PERMISSION);
  const r = await service.analyseJob(jobId, actorOf(session));
  revalidatePath(`/data/import/${jobId}`);
  if (!r.ok) redirect(`/data/import/${jobId}?error=${encodeURIComponent(r.reason)}`);
}

export async function commit(jobId: number) {
  const session = await requirePermission(PERMISSION);
  const r = await service.commitJob(jobId, actorOf(session));
  revalidatePath("/data/batches");
  revalidatePath("/pharmacies");
  revalidatePath(`/data/import/${jobId}`);
  if (!r.ok) redirect(`/data/import/${jobId}?error=${encodeURIComponent(r.reason)}`);
  redirect(`/data/import/${jobId}?committed=1`);
}

export async function cancel(jobId: number) {
  const session = await requirePermission(PERMISSION);
  const { prisma } = await import("../db");
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (job && job.status !== "COMMITTED") {
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "CANCELLED" } });
    await prisma.auditEvent.create({
      data: { eventType: "IMPORT_CANCELLED", detail: job.name,
              actor: session.email, actorId: session.userId, actorRole: session.role } });
  }
  redirect("/data/import");
}
