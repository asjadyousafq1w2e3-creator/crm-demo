/**
 * Replace the registry with an already-filtered candidate CSV. No exclusion rules are rerun.
 * Dry run: npx tsx scripts/replace-pharmacies-from-csv.ts ../pharmacy_candidates.csv --expected-rows 974
 * Apply: add --apply. A full, snapshot-consistent Postgres backup is required before deletion.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseFile } from "../lib/import/parse";
import { classifyEmail, matchName, normalizeEmail, normalizeState } from "../lib/import/normalize";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expected = Number(args[args.indexOf("--expected-rows") + 1]);
const mapping = {
  name: "Pharmacy name", pharmacyType: "Pharmacy type",
  ownerName: "Owner, buyer or pharmacist-in-charge", phone: "Business phone",
  email: "Public business email", website: "Website", streetAddress: "Street address",
  city: "City", county: "County", state: "State", zipCode: "ZIP code",
  licenseNumber: "State pharmacy license number", licenseStatus: "License status",
};
const nullable = (value: string | undefined) => value?.trim() || null;
const roleFor = (title: string) => /\bowner\b/i.test(title) ? "OWNER"
  : /pharmacist.in.charge|\bPIC\b/i.test(title) ? "PIC"
  : /\bbuyer\b|purchasing/i.test(title) ? "BUYER" : "GENERAL";
const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

async function main() {
  if (!args[0] || args[0].startsWith("--") || !args.includes("--expected-rows") ||
      !Number.isSafeInteger(expected) || expected < 1) {
    throw new Error("Provide a CSV path and --expected-rows N; add --apply to replace the registry.");
  }
  const sourcePath = path.resolve(args[0]);
  const buffer = readFileSync(sourcePath);
  const hash = digest(buffer);
  const { headers, rows } = await parseFile(buffer, "csv");
  for (const header of [...Object.values(mapping), "Record ID", "Filter classification",
    "Email-verification result", "Ownership status", "Operating status", "Contact name", "Contact title"]) {
    if (!headers.includes(header)) throw new Error(`Missing column: ${header}`);
  }
  if (rows.length !== expected) throw new Error(`Expected ${expected} rows, found ${rows.length}.`);
  const recordIds = new Set<string>();
  const emails = new Set<string>();
  const locations = new Set<string>();
  const byState: Record<string, number> = {};
  const warnings: string[] = [];
  const candidates: Prisma.PharmacyCreateManyInput[] = rows.map((row, i) => {
    const name = nullable(row["Pharmacy name"]);
    const recordId = nullable(row["Record ID"]);
    const rawEmail = nullable(row["Public business email"]);
    const state = normalizeState(row.State);
    if (!name || !recordId || !rawEmail || !state) throw new Error(`Row ${i + 1}: missing identity, email or state.`);
    if (recordIds.has(recordId)) throw new Error(`Duplicate record ID: ${recordId}`);
    recordIds.add(recordId);
    const email = normalizeEmail(rawEmail) ?? rawEmail;
    if (emails.has(email.toLowerCase())) throw new Error(`Row ${i + 1}: duplicate primary email.`);
    emails.add(email.toLowerCase());
    const location = JSON.stringify([name, row["Street address"], state, row["ZIP code"]].map(v => v.toLowerCase()));
    if (locations.has(location)) throw new Error(`Row ${i + 1}: duplicate pharmacy location.`);
    locations.add(location);
    // This command is for candidate lists, never a way to overwrite supplied verification evidence.
    if (row["Filter classification"] !== "INDEPENDENT_CANDIDATE" ||
        row["Email-verification result"] !== "Unknown — not mailbox verified" ||
        row["License status"] !== "Not checked" || row["Ownership status"] !== "Unverified" ||
        row["Operating status"] !== "Not checked" || nullable(row["Date information was verified"])) {
      throw new Error(`Row ${i + 1}: unexpected classification or verification evidence; review the mapping.`);
    }
    const verdict = classifyEmail(rawEmail);
    const warning = verdict.ok ? null : `Email requires review: ${verdict.reason}; source value retained.`;
    if (warning) warnings.push(`Row ${i + 1} (${recordId}): ${warning}`);
    byState[state] = (byState[state] ?? 0) + 1;
    return {
      canonicalName: name, normalizedName: matchName(name), pharmacyType: nullable(row["Pharmacy type"]),
      streetAddress: nullable(row["Street address"]), city: nullable(row.City), county: nullable(row.County),
      state, zipCode: nullable(row["ZIP code"]), phone: nullable(row["Business phone"]), email,
      website: nullable(row.Website), ownerName: nullable(row["Owner, buyer or pharmacist-in-charge"]),
      primaryLicenseNumber: nullable(row["State pharmacy license number"]), licenseStatus: "UNKNOWN",
      emailSource: nullable(row["Email source"]), emailKind: verdict.ok ? verdict.kind : "UNKNOWN",
      notes: [nullable(row.Notes), `Source record ID: ${recordId}.`,
        `Source contact: ${row["Contact name"]} (${row["Contact title"]}).`, warning].filter(Boolean).join("\n"),
      dataStatus: "DATA_READY", verificationStatus: "READY_FOR_VERIFICATION", campaignEligible: false,
      ownershipStatus: "UNKNOWN", operationalStatus: "UNKNOWN", emailVerificationStatus: "NOT_CHECKED",
      status: "ACTIVE", crmStatus: "NEW", leadStatus: "NOT_CONTACTED",
    };
  });
  const oldCount = await prisma.pharmacy.count();
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", sourcePath, sha256: hash,
    existingPharmacies: oldCount, replacementPharmacies: rows.length, states: Object.keys(byState).length,
    withEmail: candidates.filter(p => p.email).length, withPhone: candidates.filter(p => p.phone).length,
    warnings }, null, 2));
  if (!apply) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.resolve("storage/backups", `registry-replacement-${stamp}`);
  const importDir = path.resolve(process.env.IMPORT_STORAGE_DIR || "storage/imports");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  mkdirSync(importDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDir, "before-replacement.dump");
  const storedPath = path.join(importDir, `filtered-${hash.slice(0, 12)}-pharmacy_candidates.csv`);
  writeFileSync(storedPath, buffer, { mode: 0o600 });
  const dbUrl = new URL(process.env.DATABASE_URL!);
  const sourceId = `FILTERED_CSV:${hash.slice(0, 12)}`;

  const result = await prisma.$transaction(async tx => {
    // Block concurrent writes during the backup and replacement, including background workers.
    const tables = await tx.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    const names = tables.map(t => `public."${t.tablename.replace(/"/g, '""')}"`).join(", ");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
    await tx.$executeRawUnsafe(`LOCK TABLE ${names} IN SHARE ROW EXCLUSIVE MODE`);
    if (await tx.pharmacy.count() !== oldCount) throw new Error("Registry changed since validation; rerun.");
    if (await tx.campaign.count({ where: { status: { in: ["RUNNING", "SENDING"] } } })) {
      throw new Error("Pause active campaigns before replacing the registry.");
    }
    const protectedBefore = {
      users: await tx.appUser.findMany({ orderBy: { id: "asc" } }),
      settings: await tx.appSetting.findMany({ orderBy: { key: "asc" } }),
      mailboxes: await tx.mailbox.findMany({ orderBy: { id: "asc" } }),
      suppressions: await tx.suppressionEntry.findMany({ orderBy: { id: "asc" } }),
    };
    const [{ snapshot }] = await tx.$queryRaw<{ snapshot: string }[]>`SELECT pg_export_snapshot() AS snapshot`;
    execFileSync("pg_dump", ["--format=custom", "--no-password", "--host", dbUrl.hostname,
      "--port", dbUrl.port || "5432", "--username", decodeURIComponent(dbUrl.username),
      "--dbname", decodeURIComponent(dbUrl.pathname.slice(1)), "--snapshot", snapshot, "--file", backupPath], {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(dbUrl.password),
        ...(dbUrl.searchParams.has("sslmode") ? { PGSSLMODE: dbUrl.searchParams.get("sslmode")! } : {}) },
      timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
    });
    chmodSync(backupPath, 0o600);
    execFileSync("pg_restore", ["--list", backupPath], { stdio: "pipe" });
    console.log(`Full database backup: ${backupPath}`);

    // Delete pharmacy data and dependent records, retaining operator accounts, settings and audit history.
    // Sequences are deliberately not reset: old audit entries must never refer to new pharmacies.
    await tx.importJob.deleteMany();
    await tx.emailVerificationBatch.deleteMany();
    await tx.pharmacy.deleteMany();
    await tx.importBatch.deleteMany();
    const now = new Date();
    const batch = await tx.importBatch.create({ data: {
      label: `Filtered pharmacy candidates (${rows.length})`, source: path.basename(sourcePath),
      sourceType: "COMMERCIAL", startedAt: now, completedAt: now, status: "OK",
      recordsReceived: rows.length, recordsAccepted: rows.length, contentSha256: hash,
      detail: `Replaced ${oldCount} pharmacies with the supplied filtered list. ${warnings.length} email warning(s). Backup: ${backupPath}`,
    } });
    const created = await tx.pharmacy.createManyAndReturn({
      data: candidates.map(p => ({ ...p, importBatchId: batch.id })), select: { id: true, email: true },
    });
    const idByEmail = new Map(created.map(p => [p.email!, p.id]));
    const job = await tx.importJob.create({ data: {
      name: batch.label, sourceType: "COMMERCIAL", status: "COMMITTED", declaredColumns: headers,
      mapping, fileName: path.basename(sourcePath), fileFormat: "csv", fileBytes: buffer.length,
      contentHash: hash, storedPath, totalRows: rows.length, batchId: batch.id, committedAt: now,
      analysis: { totalRows: rows.length, accepted: rows.length, review: 0, excluded: 0,
        withEmail: rows.length, withPhone: candidates.filter(p => p.phone).length,
        sharedInboxes: candidates.filter(p => p.emailKind === "SHARED").length, byState, ruleCounts: {}, duplicates: 0,
        notes: ["Supplied filtered list accepted as requested; no exclusion rules rerun.", ...warnings] },
    } });
    const sourceFields = new Map(Object.entries(mapping).map(([field, header]) => [header, field]));
    // Chunk the provenance as well as the rows to stay below Postgres's bind-parameter limit.
    for (let offset = 0; offset < rows.length; offset += 100) {
      const slice = rows.slice(offset, offset + 100);
      const ids = slice.map((_, i) => idByEmail.get(candidates[offset + i].email!)!);
      await tx.importRow.createMany({ data: slice.map((raw, i) => ({
        jobId: job.id, rowNumber: offset + i + 1, raw,
        cleaned: { ...candidates[offset + i], name: candidates[offset + i].canonicalName,
          licenseNumber: candidates[offset + i].primaryLicenseNumber } as Prisma.InputJsonObject,
        pharmacyId: ids[i], decision: "ACCEPTED", reason: "Supplied prefiltered candidate list",
        notes: classifyEmail(raw["Public business email"]).ok ? []
          : ["Email format requires review; source value retained."],
      })) });
      await tx.pharmacyIdentifier.createMany({ data: slice.map((row, i) => ({
        pharmacyId: ids[i], kind: "SOURCE_RECORD_ID", value: row["Record ID"], sourceId, recordedAt: now,
      })) });
      await tx.fieldProvenance.createMany({ data: slice.flatMap((row, i) =>
        Object.entries(row).filter(([, value]) => value).map(([header, value]) => ({
          pharmacyId: ids[i], field: sourceFields.get(header) ?? header, value, sourceId,
          sourceType: "COMMERCIAL", authorityRank: 50, isSelected: true, retrievedAt: now,
        }))) });
      await tx.pharmacyContact.createMany({ data: slice.flatMap((row, i) => {
        const primary = candidates[offset + i].email!;
        const addresses = [...new Set([primary, ...row["Available source emails"].split(";")
          .map(email => email.trim()).filter(Boolean)])];
        return addresses.map(email => ({
          pharmacyId: ids[i], name: email === primary ? nullable(row["Contact name"]) : null,
          role: email === primary ? roleFor(row["Contact title"]) : "UNKNOWN", email,
          phone: nullable(row["Business phone"]), sourceId, sourceType: "COMMERCIAL",
          retrievedAt: now, emailStatus: "DISCOVERED", isPrimary: email === primary,
        }));
      }) });
      await tx.verificationTask.createMany({ data: ids.flatMap(pharmacyId =>
        ["LICENSE", "OWNERSHIP", "OPERATIONAL_STATUS", "PHARMACY_TYPE", "CONTACT", "EMAIL"].map(verificationType => ({
          pharmacyId, verificationType, status: "NOT_STARTED", priority: 50,
          trigger: "NEW_RECORD", batchId: batch.id,
        }))) });
    }
    const actual = await tx.pharmacy.findMany({ orderBy: { id: "asc" } });
    if (actual.length !== expected || actual.some(p => p.importBatchId !== batch.id || p.campaignEligible ||
        p.emailVerificationStatus !== "NOT_CHECKED" || p.verifiedAt || p.emailCheckedAt)) {
      throw new Error("Replacement validation failed; rolling back.");
    }
    for (const candidate of candidates) {
      const saved = actual.find(p => p.email === candidate.email);
      if (!saved || Object.entries(candidate).some(([key, value]) => saved[key as keyof typeof saved] !== value)) {
        throw new Error("Source field comparison failed; rolling back.");
      }
    }
    const protectedAfter = {
      users: await tx.appUser.findMany({ orderBy: { id: "asc" } }),
      settings: await tx.appSetting.findMany({ orderBy: { key: "asc" } }),
      mailboxes: await tx.mailbox.findMany({ orderBy: { id: "asc" } }),
      suppressions: await tx.suppressionEntry.findMany({ orderBy: { id: "asc" } }),
    };
    if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) throw new Error("Unrelated CRM data changed; rolling back.");
    if (await tx.importRow.count({ where: { jobId: job.id } }) !== expected ||
        await tx.pharmacyIdentifier.count({ where: { sourceId } }) !== expected ||
        await tx.verificationTask.count() !== expected * 6) throw new Error("Dependent record validation failed.");
    await tx.auditEvent.create({ data: { eventType: "PHARMACY_REGISTRY_REPLACED", actor: "workspace-import",
      batchId: batch.id, detail: JSON.stringify({ sourcePath, sha256: hash, removed: oldCount,
        imported: expected, backupPath, warnings }) } });
    return { removed: oldCount, imported: actual.length, batchId: batch.id, jobId: job.id,
      contacts: await tx.pharmacyContact.count(), verificationTasks: await tx.verificationTask.count(),
      byState, warnings, backupPath, storedPath, sha256: hash };
  }, { isolationLevel: "RepeatableRead", maxWait: 10000, timeout: 120000 });
  writeFileSync(path.join(backupDir, "replacement-report.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log("Replacement committed:", JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
