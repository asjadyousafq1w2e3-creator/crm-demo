/**
 * One-way migration: Phase 3 SQLite registry -> Postgres.
 *
 * Imports only the curated cohort (import_batch_id IS NOT NULL) plus everything that hangs off
 * it. The SQLite file holds 54k unfiltered Phase 2 masters as well; those are not the CRM's
 * population and are deliberately left behind.
 *
 * Idempotent: truncates the Postgres tables first, so re-running gives the same result.
 */
import Database from "better-sqlite3";
import { PrismaClient } from "@prisma/client";
import path from "node:path";

const SQLITE = path.resolve(process.cwd(), "../data/pharmacy.db");
const prisma = new PrismaClient();
const BATCH = 1000;

const date = (v: unknown): Date =>
  v ? new Date(String(v)) : new Date();
const dateOrNull = (v: unknown): Date | null =>
  v ? new Date(String(v)) : null;
const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

async function chunked<T>(rows: T[], label: string, fn: (slice: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await fn(rows.slice(i, i + BATCH));
    process.stdout.write(`\r  ${label}: ${Math.min(i + BATCH, rows.length).toLocaleString()}/${rows.length.toLocaleString()}`);
  }
  process.stdout.write("\n");
}

async function main() {
  const db = new Database(SQLITE, { readonly: true });
  console.log(`  source: ${SQLITE}`);

  console.log("  clearing Postgres tables…");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    verification_result, verification_task, field_change, field_provenance,
    pharmacy_identifier, pharmacy_contact, audit_event, pharmacy_master,
    pharmacy_import_batch RESTART IDENTITY CASCADE`);

  // ---- batches ------------------------------------------------------------------
  const batches = db.prepare(`SELECT * FROM pharmacy_import_batch`).all() as any[];
  await prisma.importBatch.createMany({
    data: batches.map((b) => ({
      id: b.id, label: b.label, source: b.source, sourceType: b.source_type,
      jurisdiction: str(b.jurisdiction), datasetDate: str(b.dataset_date),
      startedAt: date(b.started_at), completedAt: dateOrNull(b.completed_at),
      status: b.status, recordsReceived: b.records_received ?? 0,
      recordsAccepted: b.records_accepted ?? 0, recordsUpdated: b.records_updated ?? 0,
      recordsUnchanged: b.records_unchanged ?? 0, recordsRejected: b.records_rejected ?? 0,
      recordsReviewRequired: b.records_review_required ?? 0,
      duplicatesPrevented: b.duplicates_prevented ?? 0,
      contentSha256: str(b.content_sha256), detail: str(b.detail), createdAt: date(b.created_at),
    })),
  });
  console.log(`  batches: ${batches.length}`);

  // ---- the curated cohort only ----------------------------------------------------
  const pharmacies = db.prepare(
    `SELECT * FROM pharmacy_master WHERE import_batch_id IS NOT NULL`).all() as any[];
  const ids = new Set(pharmacies.map((p) => p.id));

  await chunked(pharmacies, "pharmacies", (slice) =>
    prisma.pharmacy.createMany({
      data: slice.map((p) => ({
        id: p.id, canonicalName: p.canonical_name ?? "UNKNOWN",
        normalizedName: str(p.normalized_name), doingBusinessAs: str(p.doing_business_as),
        pharmacyType: str(p.pharmacy_type), streetAddress: str(p.street_address),
        addressLine2: str(p.address_line_2), city: str(p.city), county: str(p.county),
        state: str(p.state), zipCode: str(p.zip_code), phone: str(p.phone),
        email: str(p.email), website: str(p.website), ownerName: str(p.owner_name),
        picName: str(p.pic_name), buyerName: str(p.buyer_name),
        primaryLicenseNumber: str(p.primary_license_number),
        licenseStatus: str(p.license_status), licenseType: str(p.license_type),
        npi: str(p.npi), ncpdpId: str(p.ncpdp_id),
        numberOfLocations: p.number_of_locations ?? null,
        dataStatus: p.data_status ?? "DATA_READY",
        verificationStatus: p.verification_status ?? "READY_FOR_VERIFICATION",
        campaignEligible: !!p.campaign_eligible,
        ownershipStatus: p.ownership_status ?? "UNKNOWN",
        operationalStatus: p.operational_status ?? "UNKNOWN",
        emailVerificationStatus: p.email_verification_status ?? "NOT_CHECKED",
        crmStatus: p.crm_status ?? "NEW", exclusionReason: str(p.exclusion_reason),
        licenseVerificationStatus: p.license_verification_status ?? "NOT_STARTED",
        ownershipVerificationStatus: p.ownership_verification_status ?? "NOT_STARTED",
        operationalVerificationStatus: p.operational_verification_status ?? "NOT_STARTED",
        pharmacyTypeVerificationStatus: p.pharmacy_type_verification_status ?? "NOT_STARTED",
        contactVerificationStatus: p.contact_verification_status ?? "NOT_STARTED",
        status: p.status ?? "ACTIVE", sourceMissing: !!p.source_missing,
        missingSince: dateOrNull(p.missing_since), importBatchId: p.import_batch_id,
        createdAt: date(p.created_at), updatedAt: date(p.updated_at),
      })),
    }));

  const only = (rows: any[]) => rows.filter((r) => ids.has(r.pharmacy_id));

  const contacts = only(db.prepare(`SELECT * FROM pharmacy_contact`).all() as any[]);
  await chunked(contacts, "contacts", (s) =>
    prisma.pharmacyContact.createMany({
      data: s.map((c) => ({
        pharmacyId: c.pharmacy_id, name: str(c.name), role: c.role ?? "UNKNOWN",
        email: str(c.email), phone: str(c.phone), sourceId: c.source_id,
        sourceType: c.source_type, sourceUrl: str(c.source_url),
        retrievedAt: date(c.retrieved_at), emailStatus: c.email_status ?? "DISCOVERED",
      })), skipDuplicates: true,
    }));

  const idents = only(db.prepare(`SELECT * FROM pharmacy_identifier`).all() as any[]);
  await chunked(idents, "identifiers", (s) =>
    prisma.pharmacyIdentifier.createMany({
      data: s.map((i) => ({
        pharmacyId: i.pharmacy_id, kind: i.kind, value: i.value,
        jurisdiction: str(i.jurisdiction), sourceId: i.source_id,
        recordedAt: date(i.recorded_at),
      })), skipDuplicates: true,
    }));

  const prov = only(db.prepare(`SELECT * FROM field_provenance`).all() as any[]);
  await chunked(prov, "provenance", (s) =>
    prisma.fieldProvenance.createMany({
      data: s.map((p) => ({
        pharmacyId: p.pharmacy_id, field: p.field, value: str(p.value),
        sourceId: p.source_id, sourceType: p.source_type, sourceUrl: str(p.source_url),
        authorityRank: p.authority_rank ?? 99, isSelected: !!p.is_selected,
        datasetDate: str(p.dataset_date), retrievedAt: date(p.retrieved_at),
      })), skipDuplicates: true,
    }));

  const changes = only(db.prepare(`SELECT * FROM field_change`).all() as any[]);
  await chunked(changes, "changes", (s) =>
    prisma.fieldChange.createMany({
      data: s.map((c) => ({
        pharmacyId: c.pharmacy_id, sourceId: c.source_id, field: c.field,
        oldValue: str(c.old_value), newValue: str(c.new_value),
        changeType: c.change_type, detectedAt: date(c.detected_at),
      })),
    }));

  const tasks = only(db.prepare(`SELECT * FROM verification_task`).all() as any[]);
  await chunked(tasks, "tasks", (s) =>
    prisma.verificationTask.createMany({
      data: s.map((t) => ({
        pharmacyId: t.pharmacy_id, verificationType: t.verification_type,
        status: t.status ?? "NOT_STARTED", priority: t.priority ?? 50,
        trigger: t.trigger, batchId: t.batch_id, result: str(t.result),
        notes: str(t.notes), createdAt: date(t.created_at), updatedAt: date(t.updated_at),
      })),
    }));

  // keep Postgres sequences ahead of the imported ids
  for (const t of ["pharmacy_master", "pharmacy_import_batch", "pharmacy_contact",
                   "pharmacy_identifier", "field_provenance", "field_change",
                   "verification_task"]) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('${t}','id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`);
  }

  const counts = {
    pharmacies: await prisma.pharmacy.count(),
    contacts: await prisma.pharmacyContact.count(),
    provenance: await prisma.fieldProvenance.count(),
    tasks: await prisma.verificationTask.count(),
    batches: await prisma.importBatch.count(),
    withEmail: await prisma.pharmacy.count({ where: { email: { not: null } } }),
    verified: await prisma.pharmacy.count({ where: { verificationStatus: "VERIFIED" } }),
  };
  console.log("\n  imported:", counts);
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
