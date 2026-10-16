/**
 * Import job lifecycle: declare the shape, upload against it, analyse, then commit.
 *
 * Nothing reaches the registry before commit. Analysis can be re-run as often as an operator
 * likes, because it only ever writes to the job's own rows.
 */
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "../db";
import { config } from "../config";
import { actorFields, type Actor } from "../audit";
import { REQUIRED_FIELDS } from "./fields";
import { formatFor, parseFile } from "./parse";
import { runRules, type Analysis, type Mapping, type RawRow } from "./engine";

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
/** Rows above this are refused: an import this large is a pipeline job, not a browser upload. */
export const MAX_ROWS = 200_000;

export type JobResult<T = void> = { ok: true; value: T } | { ok: false; reason: string };

const fail = (reason: string): JobResult<never> => ({ ok: false, reason });

/* ------------------------------------------------------------------ declare */

export async function declareJob(input: {
  name: string; sourceType: string; jurisdiction?: string; datasetDate?: string;
  columns: string[]; mapping: Mapping;
}, actor?: Actor): Promise<JobResult<number>> {
  const columns = input.columns.map((c) => c.trim()).filter(Boolean);
  if (!input.name.trim()) return fail("give the dataset a name");
  if (columns.length < 2) return fail("declare at least two columns");
  if (new Set(columns.map((c) => c.toLowerCase())).size !== columns.length)
    return fail("two declared columns have the same name");

  for (const field of REQUIRED_FIELDS) {
    if (!input.mapping[field])
      return fail(field === "email"
        ? "an email column is required - this registry exists to reach pharmacies by email"
        : `choose which column supplies "${field}"`);
  }
  for (const [field, column] of Object.entries(input.mapping)) {
    if (column && !columns.includes(column))
      return fail(`"${column}" is mapped to ${field} but is not one of the declared columns`);
  }

  const job = await prisma.importJob.create({
    data: {
      name: input.name.trim(), sourceType: input.sourceType,
      jurisdiction: input.jurisdiction?.trim().toUpperCase() || null,
      datasetDate: input.datasetDate || null,
      status: "DECLARED", declaredColumns: columns, mapping: input.mapping as object,
      createdById: actor?.userId ?? null,
    },
  });
  await prisma.auditEvent.create({
    data: { eventType: "IMPORT_DECLARED", detail: `${job.name} (${columns.length} columns)`,
            ...actorFields(actor) } });
  return { ok: true, value: job.id };
}

/* ------------------------------------------------------------------ upload */

export type HeaderCheck = {
  declared: string[];
  actual: string[];
  missing: string[];   // declared but absent from the file
  extra: string[];     // present in the file but never declared
  matches: boolean;
};

export function compareHeaders(declared: string[], actual: string[]): HeaderCheck {
  const norm = (s: string) => s.trim().toLowerCase();
  const a = new Set(actual.map(norm));
  const d = new Set(declared.map(norm));
  const missing = declared.filter((c) => !a.has(norm(c)));
  const extra = actual.filter((c) => !d.has(norm(c)));
  return { declared, actual, missing, extra, matches: missing.length === 0 && extra.length === 0 };
}

async function storageDir(): Promise<string> {
  const dir = config.importStorageDir;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function attachFile(
  jobId: number, fileName: string, buffer: Buffer, actor?: Actor,
): Promise<JobResult<{ headers: string[]; rowCount: number; check: HeaderCheck }>> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return fail("import not found");
  if (job.status === "COMMITTED") return fail("this import has already been committed");
  if (buffer.length === 0) return fail("the file is empty");
  if (buffer.length > MAX_UPLOAD_BYTES)
    return fail(`the file is ${(buffer.length / 1048576).toFixed(1)} MB; the limit is ` +
                `${MAX_UPLOAD_BYTES / 1048576} MB`);

  const format = formatFor(fileName);
  if (!format) return fail("unsupported file type - use .csv, .tsv, .psv, .txt or .xlsx");

  let parsed;
  try {
    parsed = await parseFile(buffer, format);
  } catch (e) {
    return fail(`the file could not be read: ${(e as Error).message}`);
  }
  if (!parsed.headers.length) return fail("no header row found");
  if (!parsed.rows.length) return fail("the file has a header but no data rows");
  if (parsed.rows.length > MAX_ROWS)
    return fail(`${parsed.rows.length.toLocaleString()} rows exceeds the ` +
                `${MAX_ROWS.toLocaleString()} row limit for a browser upload`);

  const check = compareHeaders(job.declaredColumns as string[], parsed.headers);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  // The original file is kept: it is the only true record of what was supplied.
  const stored = path.join(await storageDir(), `job-${jobId}-${hash.slice(0, 12)}-${safe(fileName)}`);
  await fs.writeFile(stored, buffer);

  await prisma.$transaction([
    prisma.importRow.deleteMany({ where: { jobId } }),
    prisma.importJob.update({
      where: { id: jobId },
      data: {
        fileName, fileFormat: format, fileBytes: buffer.length, contentHash: hash,
        storedPath: stored, totalRows: parsed.rows.length, status: "UPLOADED", analysis: undefined,
      },
    }),
  ]);

  // Rows are stored as read. Preprocessing writes its verdict alongside, never over the top.
  await insertRows(jobId, parsed.rows);
  await prisma.auditEvent.create({
    data: { eventType: "IMPORT_UPLOADED",
            detail: `${job.name}: ${fileName}, ${parsed.rows.length.toLocaleString()} rows`,
            ...actorFields(actor) } });

  return { ok: true, value: { headers: parsed.headers, rowCount: parsed.rows.length, check } };
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(-60);

async function insertRows(jobId: number, rows: RawRow[]) {
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.importRow.createMany({
      data: rows.slice(i, i + CHUNK).map((raw, j) => ({
        jobId, rowNumber: i + j + 1, raw: raw as object, decision: "ACCEPTED",
      })),
      skipDuplicates: true,
    });
  }
}

/* ------------------------------------------------------------------ analyse */

export async function analyseJob(jobId: number, actor?: Actor): Promise<JobResult<Analysis>> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return fail("import not found");
  if (job.status === "DECLARED") return fail("upload a file first");
  if (job.status === "COMMITTED") return fail("this import has already been committed");

  const rows = await prisma.importRow.findMany({ where: { jobId }, orderBy: { rowNumber: "asc" } });
  const { verdicts, analysis } = runRules(
    rows.map((r) => r.raw as RawRow), job.mapping as Mapping);

  // Written back per row so "why was this dropped?" always has an answer.
  const CHUNK = 500;
  for (let i = 0; i < verdicts.length; i += CHUNK) {
    await prisma.$transaction(verdicts.slice(i, i + CHUNK).map((v) =>
      prisma.importRow.update({
        where: { jobId_rowNumber: { jobId, rowNumber: v.rowNumber } },
        data: { cleaned: v.cleaned as object, decision: v.decision, reason: v.reason,
                notes: v.notes as object },
      })));
  }

  await prisma.importJob.update({
    where: { id: jobId }, data: { status: "ANALYSED", analysis: analysis as object } });
  await prisma.auditEvent.create({
    data: { eventType: "IMPORT_ANALYSED",
            detail: `${job.name}: ${analysis.accepted} accepted, ${analysis.review} review, ` +
                    `${analysis.excluded} excluded`,
            ...actorFields(actor) } });
  return { ok: true, value: analysis };
}

/* ------------------------------------------------------------------ commit */

export type CommitResult = {
  created: number; updated: number; unchanged: number; review: number; skipped: number;
  batchId: number;
};

/**
 * Writes the surviving rows into the registry.
 *
 * Matching order mirrors Phase 3: a state licence identity is decisive, and name + address is the
 * fallback. A match updates by source authority - a state board outranks a commercial file - and
 * never blanks a field the upload has nothing to say about.
 */
export async function commitJob(jobId: number, actor?: Actor): Promise<JobResult<CommitResult>> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return fail("import not found");
  if (job.status !== "ANALYSED") return fail("analyse the file before committing it");
  if (job.batchId) return fail("this import has already been committed");

  const rows = await prisma.importRow.findMany({
    where: { jobId, decision: { in: ["ACCEPTED", "REVIEW"] } }, orderBy: { rowNumber: "asc" } });
  if (!rows.length) return fail("no rows survived preprocessing - nothing to commit");

  const batch = await prisma.importBatch.create({
    data: {
      label: job.name, source: job.fileName ?? job.name, sourceType: job.sourceType,
      jurisdiction: job.jurisdiction, datasetDate: job.datasetDate,
      startedAt: new Date(), status: "OK", recordsReceived: job.totalRows ?? rows.length,
      contentSha256: job.contentHash,
    },
  });

  const out: CommitResult = { created: 0, updated: 0, unchanged: 0, review: 0, skipped: 0,
                              batchId: batch.id };

  for (const row of rows) {
    const c = row.cleaned as unknown as CleanedForCommit | null;
    if (!c || !c.name) { out.skipped++; continue; }

    const existing = await findExisting(c);
    const needsReview = row.decision === "REVIEW";

    if (!existing) {
      const created = await prisma.pharmacy.create({
        data: {
          canonicalName: c.name, normalizedName: matchKey(c.name),
          doingBusinessAs: c.doingBusinessAs, pharmacyType: c.pharmacyType,
          streetAddress: c.streetAddress, addressLine2: c.addressLine2, city: c.city,
          county: c.county, state: c.state, zipCode: c.zipCode,
          phone: c.phone, email: c.email, emailKind: c.emailKind, website: c.website,
          ownerName: c.ownerName, picName: c.picName,
          primaryLicenseNumber: c.licenseNumber, licenseStatus: mapStatus(c.licenseStatus),
          licenseType: c.licenseType, npi: c.npi, ncpdpId: c.ncpdpId,
          importBatchId: batch.id,
          verificationStatus: needsReview ? "NEEDS_REVIEW" : "READY_FOR_VERIFICATION",
          exclusionReason: needsReview ? row.reason : null,
        },
      });
      await prisma.importRow.update({ where: { id: row.id }, data: { pharmacyId: created.id } });
      await recordProvenance(created.id, c, batch.id, job.sourceType);
      out.created++;
      if (needsReview) out.review++;
      continue;
    }

    // An upload only ever fills or improves; it never blanks what it does not mention.
    const patch = buildPatch(existing, c, job.sourceType);
    await prisma.importRow.update({ where: { id: row.id }, data: { pharmacyId: existing.id } });
    if (Object.keys(patch).length === 0) { out.unchanged++; continue; }

    await prisma.pharmacy.update({ where: { id: existing.id }, data: patch });
    await recordProvenance(existing.id, c, batch.id, job.sourceType);
    out.updated++;
  }

  await prisma.$transaction([
    prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        recordsAccepted: out.created, recordsUpdated: out.updated,
        recordsUnchanged: out.unchanged, recordsReviewRequired: out.review,
        recordsRejected: (job.analysis as unknown as Analysis | null)?.excluded ?? 0,
        duplicatesPrevented: out.updated + out.unchanged,
        completedAt: new Date(),
        detail: `${out.created} new, ${out.updated} updated, ${out.unchanged} unchanged`,
      },
    }),
    prisma.importJob.update({
      where: { id: jobId },
      data: { status: "COMMITTED", batchId: batch.id, committedAt: new Date() },
    }),
  ]);

  await prisma.auditEvent.create({
    data: { eventType: "IMPORT_COMMITTED", batchId: batch.id,
            detail: `${job.name}: ${out.created} new, ${out.updated} updated, ` +
                    `${out.unchanged} unchanged`,
            ...actorFields(actor) } });
  return { ok: true, value: out };
}

type CleanedForCommit = {
  name: string | null; doingBusinessAs: string | null; email: string | null;
  emailKind: string; phone: string | null; website: string | null;
  streetAddress: string | null; addressLine2: string | null; city: string | null;
  county: string | null; state: string | null; zipCode: string | null;
  licenseNumber: string | null; licenseStatus: string | null; licenseType: string | null;
  pharmacyType: string | null; ownerName: string | null; picName: string | null;
  npi: string | null; ncpdpId: string | null;
};

const matchKey = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|pa|pc|pllc|lp|llp|the)\b/g, " ")
    .replace(/\s+/g, " ").trim();

/** Licence status words mapped to the registry's own vocabulary. */
function mapStatus(raw: string | null): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("active") || ["clear", "current", "valid", "open", "licensed",
      "registered", "in good standing", "good standing"].includes(s)) return "ACTIVE";
  for (const [word, code] of [["expired", "EXPIRED"], ["revoked", "REVOKED"],
                              ["suspend", "SUSPENDED"], ["closed", "CLOSED"],
                              ["surrender", "CLOSED"], ["inactive", "INACTIVE"]] as const) {
    if (s.includes(word)) return code;
  }
  return "UNKNOWN";
}

/** Licence identity first, then name and address. Never name alone - names repeat constantly. */
async function findExisting(c: CleanedForCommit) {
  if (c.licenseNumber && c.state) {
    const byLicence = await prisma.pharmacy.findFirst({
      where: { primaryLicenseNumber: c.licenseNumber, state: c.state } });
    if (byLicence) return byLicence;
  }
  if (c.npi) {
    const byNpi = await prisma.pharmacy.findFirst({ where: { npi: c.npi } });
    if (byNpi) return byNpi;
  }
  if (c.name && c.zipCode) {
    const candidates = await prisma.pharmacy.findMany({
      where: { zipCode: c.zipCode, normalizedName: matchKey(c.name) }, take: 2 });
    // Two records with the same normalised name at the same ZIP is genuinely ambiguous; a guess
    // here would merge two businesses, so neither is chosen.
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

/**
 * A state board outranks a commercial file, which outranks a manual entry. Equal authority means
 * the newer value wins; lower authority may only fill a blank.
 */
const AUTHORITY: Record<string, number> = { STATE_BOARD: 1, COMMERCIAL: 2, MANUAL: 3 };

/**
 * Exported so the rules about what an import may and may not overwrite can be tested directly.
 * Verification results are paid for per address, and "does a re-import keep them" is exactly the
 * kind of question that should be answered by a test rather than by reading the function.
 */
export function buildPatch(
  existing: Record<string, unknown>, c: CleanedForCommit, sourceType: string,
): Record<string, unknown> {
  const rank = AUTHORITY[sourceType] ?? 99;
  const patch: Record<string, unknown> = {};

  const set = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;   // never blank a field
    const current = existing[field];
    if (current === value) return;
    // Anything below a state board may only fill gaps, not overwrite an existing value.
    if (current !== null && current !== undefined && current !== "" && rank > 1) return;
    patch[field] = value;
  };

  set("doingBusinessAs", c.doingBusinessAs);
  set("email", c.email);
  set("phone", c.phone);
  set("website", c.website);
  set("streetAddress", c.streetAddress);
  set("addressLine2", c.addressLine2);
  set("city", c.city);
  set("county", c.county);
  set("state", c.state);
  set("zipCode", c.zipCode);
  set("primaryLicenseNumber", c.licenseNumber);
  set("licenseType", c.licenseType);
  set("pharmacyType", c.pharmacyType);
  set("ownerName", c.ownerName);
  set("picName", c.picName);
  set("npi", c.npi);
  set("ncpdpId", c.ncpdpId);

  const status = mapStatus(c.licenseStatus);
  if (status && status !== "UNKNOWN") set("licenseStatus", status);

  // An address that arrives where there was none also settles what kind of address it is.
  if (patch.email) patch.emailKind = c.emailKind;

  /*
   * A new address has not been verified, whatever the old one was.
   *
   * Verification is paid for per address and its verdict belongs to that exact address. Leaving
   * the old status in place when the address changes is worse than losing it: the record would
   * read VALID, become campaign-eligible, and be skipped by the next verification round for
   * already being checked - so nobody would ever pay to check it, and the first evidence that it
   * was never verified would be a bounce. Resetting costs one more verification; not resetting
   * costs sender reputation and a lie in the client's deliverable.
   */
  if (patch.email && existing.email && patch.email !== existing.email) {
    patch.emailVerificationStatus = "NOT_CHECKED";
    patch.emailCheckedAt = null;
    patch.emailCheckDetail = null;
  }

  return patch;
}

/** Per-field provenance, so every value can be traced to the file that supplied it. */
async function recordProvenance(
  pharmacyId: number, c: CleanedForCommit, batchId: number, sourceType: string,
) {
  const fields: [string, string | null][] = [
    ["email", c.email], ["phone", c.phone], ["street_address", c.streetAddress],
    ["city", c.city], ["state", c.state], ["zip_code", c.zipCode],
    ["primary_license_number", c.licenseNumber], ["license_status", c.licenseStatus],
    ["npi", c.npi], ["website", c.website], ["owner_name", c.ownerName], ["pic_name", c.picName],
  ];
  const rows = fields.filter(([, v]) => v).map(([field, value]) => ({
    pharmacyId, field, value: String(value),
    sourceId: `import-batch-${batchId}`, sourceType,
    authorityRank: AUTHORITY[sourceType] ?? 99, isSelected: true,
    retrievedAt: new Date(),
  }));
  if (rows.length) await prisma.fieldProvenance.createMany({ data: rows, skipDuplicates: true });
}
