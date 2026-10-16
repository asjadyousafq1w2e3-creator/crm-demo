import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { analyse, commit, cancel } from "@/lib/import/actions";
import { compareHeaders, MAX_UPLOAD_BYTES } from "@/lib/import/service";
import { RULES, type Analysis } from "@/lib/import/engine";
import { FIELDS } from "@/lib/import/fields";
import { Card, Empty, Note, PageHeader, Stat } from "@/components/ui";
import { HBars } from "@/components/charts";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

const STEPS = ["Declared", "Uploaded", "Analysed", "Committed"] as const;
const STEP_OF: Record<string, number> = {
  DECLARED: 0, UPLOADED: 1, ANALYSED: 2, COMMITTED: 3, CANCELLED: 0,
};

export default async function ImportJobPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; uploaded?: string; committed?: string; show?: string }>;
}) {
  await requirePagePermission("verification.manage");
  const { id } = await params;
  const sp = await searchParams;

  const job = await prisma.importJob.findUnique({
    where: { id: Number(id) }, include: { batch: true } });
  if (!job) notFound();

  const mapping = job.mapping as Record<string, string>;
  const declared = job.declaredColumns as string[];
  const analysis = job.analysis as unknown as Analysis | null;
  const step = STEP_OF[job.status] ?? 0;

  // Header comparison, recomputed from the rows actually stored rather than trusted from upload.
  const firstRow = await prisma.importRow.findFirst({
    where: { jobId: job.id }, orderBy: { rowNumber: "asc" } });
  const actualHeaders = firstRow ? Object.keys(firstRow.raw as object) : [];
  const check = actualHeaders.length ? compareHeaders(declared, actualHeaders) : null;

  const show = sp.show === "excluded" || sp.show === "review" ? sp.show : "accepted";
  const sample = job.status === "ANALYSED" || job.status === "COMMITTED"
    ? await prisma.importRow.findMany({
        where: { jobId: job.id, decision: show.toUpperCase() },
        orderBy: { rowNumber: "asc" }, take: 25 })
    : [];

  return (
    <>
      <Link href="/data/import" className="text-[12px] link">← Imports</Link>
      <PageHeader title={job.name}
        subtitle={`${job.sourceType.replace(/_/g, " ").toLowerCase()}${job.jurisdiction ? ` · ${job.jurisdiction}` : ""}${job.datasetDate ? ` · dataset dated ${job.datasetDate}` : ""}`}
        actions={job.status !== "COMMITTED" && job.status !== "CANCELLED" ? (
          <form action={cancel.bind(null, job.id)}>
            <button className="btn btn-danger btn-sm">Discard this import</button>
          </form>
        ) : undefined}>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {STEPS.map((label, i) => (
            <span key={label} className="flex items-center gap-2">
              <span className={`badge ${i < step ? "tone-ok" : i === step ? "tone-accent" : "tone-neutral"}`}>
                {i < step && <Icon name="check_circle" size={13} />}{label}
              </span>
              {i < STEPS.length - 1 && <Icon name="chevron_right" size={14} className="text-muted" />}
            </span>
          ))}
        </div>
      </PageHeader>

      {sp.error && <Note tone="bad">{sp.error}</Note>}
      {sp.committed && (
        <Note tone="ok">
          Committed to the registry.{" "}
          {job.batchId && <Link href="/data/batches" className="link">See the import batch →</Link>}
        </Note>
      )}

      {/* ---------------------------------------------------------- step 2: upload */}
      {(job.status === "DECLARED" || job.status === "UPLOADED") && (
        <Card title={job.status === "DECLARED" ? "Upload the file" : "Replace the file"}
          subtitle={`CSV, TSV, pipe-delimited or Excel · up to ${MAX_UPLOAD_BYTES / 1048576} MB`}>
          <form action="/api/import/upload" method="POST" encType="multipart/form-data"
            className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="jobId" value={job.id} />
            <label className="block flex-1 min-w-[260px]">
              <span className="block t-small text-muted mb-1">File</span>
              <input type="file" name="file" required accept=".csv,.tsv,.psv,.txt,.xlsx,.xlsm"
                className="input file:mr-3 file:rounded file:border-0 file:bg-accent
                  file:px-3 file:py-1 file:text-accent-ink file:text-[0.8125rem]" />
            </label>
            <button className="btn btn-primary">
              <Icon name="upload_file" size={16} /> Upload
            </button>
          </form>
          <p className="t-small text-muted mt-3 pt-3 hairline leading-relaxed">
            Nothing reaches the registry at this point. The file is read, checked against the
            columns you declared, and kept for provenance.
          </p>
        </Card>
      )}

      {/* ---------------------------------------------------------- header check */}
      {check && (
        <Card title="Does the file match what you declared?"
          subtitle={check.matches
            ? "Every declared column is present, and nothing unexpected came with it"
            : "The file differs from the declaration"}>
          {check.matches ? (
            <div className="flex items-center gap-2 t-body text-ok">
              <Icon name="check_circle" size={18} /> {declared.length} columns, exactly as declared.
            </div>
          ) : (
            <div className="space-y-3">
              {check.missing.length > 0 && (
                <div>
                  <div className="t-small font-medium text-bad mb-1">
                    Declared but not in the file ({check.missing.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {check.missing.map((c) => (
                      <span key={c} className="badge tone-bad font-mono normal-case">{c}</span>
                    ))}
                  </div>
                  <p className="t-small text-muted mt-1.5">
                    Any field mapped to one of these will be empty for every row.
                  </p>
                </div>
              )}
              {check.extra.length > 0 && (
                <div>
                  <div className="t-small font-medium text-warn mb-1">
                    In the file but not declared ({check.extra.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {check.extra.map((c) => (
                      <span key={c} className="badge tone-warn font-mono normal-case">{c}</span>
                    ))}
                  </div>
                  <p className="t-small text-muted mt-1.5">
                    These are read but ignored. If one of them is the column you meant to use,
                    discard this import and declare it again.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 pt-3.5 hairline">
            <div className="t-small font-medium mb-2">Column mapping</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
              {FIELDS.filter((f) => mapping[f.field]).map((f) => {
                const col = mapping[f.field];
                const present = actualHeaders.some(
                  (h) => h.trim().toLowerCase() === col.trim().toLowerCase());
                return (
                  <div key={f.field} className="flex items-center gap-2 t-small">
                    <Icon name={present ? "check_circle" : "error"} size={13}
                      className={present ? "text-ok" : "text-bad"} />
                    <span className="text-muted">{f.label}</span>
                    <span className="font-mono truncate">{col}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- step 3: analyse */}
      {job.status === "UPLOADED" && (
        <Card title="Run preprocessing"
          subtitle={`${(job.totalRows ?? 0).toLocaleString()} rows read from ${job.fileName}`}>
          <form action={analyse.bind(null, job.id)}>
            <button className="btn btn-primary">
              <Icon name="tune" size={16} /> Clean and filter the file
            </button>
          </form>
          <p className="t-small text-muted mt-3 leading-relaxed">
            Normalises every field, then applies the same rules the rest of the registry went
            through. Still nothing is written — you see the result first, rule by rule, and can
            re-run it as often as you like.
          </p>
        </Card>
      )}

      {/* ---------------------------------------------------------- results */}
      {analysis && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
            <Stat label="Rows in the file" value={analysis.totalRows} />
            <Stat label="Accepted" value={analysis.accepted} tone="ok"
              icon={<Icon name="check_circle" size={18} />} />
            <Stat label="Need review" value={analysis.review}
              tone={analysis.review ? "warn" : undefined} />
            <Stat label="Excluded" value={analysis.excluded}
              tone={analysis.excluded ? "bad" : undefined} />
            <Stat label="With an email" value={analysis.withEmail}
              hint={`${analysis.sharedInboxes.toLocaleString()} shared inboxes`} />
            <Stat label="With a phone" value={analysis.withPhone} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="What each rule removed"
              subtitle="In the order the rules run — the first one to match decides the row">
              {Object.keys(analysis.ruleCounts).length === 0 ? (
                <Empty>No rule removed or flagged a single row.</Empty>
              ) : (
                <div className="space-y-2.5">
                  {RULES.filter((r) => analysis.ruleCounts[r.id]).map((r) => (
                    <div key={r.id} className="flex items-start gap-3">
                      <span className="badge tone-neutral tabular-nums shrink-0 min-w-[52px] justify-center">
                        {analysis.ruleCounts[r.id].toLocaleString()}
                      </span>
                      <span className="min-w-0">
                        <span className="block t-body font-medium">{r.label}</span>
                        <span className="block t-small text-muted leading-snug">{r.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Where the surviving rows are"
              subtitle="Accepted and review rows, by state">
              <HBars data={Object.entries(analysis.byState)
                .sort((a, b) => b[1] - a[1]).slice(0, 12)
                .map(([state, count]) => ({ label: state, value: count }))}
                unit="rows" empty="No rows survived preprocessing." />
            </Card>
          </div>

          <Card pad={false}
            title="The rows themselves"
            subtitle="Every decision traces back to the original row"
            actions={
              <div className="flex gap-1">
                {(["accepted", "review", "excluded"] as const).map((k) => (
                  <Link key={k} href={`?show=${k}`}
                    className={`btn btn-sm ${show === k ? "btn-primary" : ""}`}>
                    {k} ({(k === "accepted" ? analysis.accepted
                        : k === "review" ? analysis.review : analysis.excluded).toLocaleString()})
                  </Link>
                ))}
              </div>
            }>
            {sample.length === 0 ? (
              <Empty>No rows in this category.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr>
                    <th>Row</th><th>Pharmacy</th><th>Location</th><th>Email</th>
                    <th>{show === "accepted" ? "Notes" : "Why"}</th>
                  </tr></thead>
                  <tbody>
                    {sample.map((r) => {
                      const c = r.cleaned as Record<string, string | null> | null;
                      const notes = (r.notes as string[] | null) ?? [];
                      return (
                        <tr key={r.id}>
                          <td className="t-mono text-muted">{r.rowNumber}</td>
                          <td className="max-w-[240px]">
                            <div className="truncate">{c?.name ?? "—"}</div>
                            {c?.licenseNumber && (
                              <div className="t-small text-muted">{c.licenseNumber}</div>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            {c?.city ?? "—"} <span className="text-muted">{c?.state ?? ""}</span>
                          </td>
                          <td className="max-w-[220px]">
                            <div className="truncate">
                              {c?.email ?? <span className="text-muted">none</span>}
                            </div>
                            {c?.emailKind === "SHARED" && (
                              <span className="badge tone-warn mt-0.5">shared</span>
                            )}
                          </td>
                          <td className="t-small text-muted max-w-[320px]">
                            {show === "accepted"
                              ? (notes.length ? notes.join(" · ") : "—")
                              : r.reason ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="t-small text-muted px-4 py-2.5">
                  Showing the first {sample.length} of this category.
                </p>
              </div>
            )}
          </Card>

          {/* ------------------------------------------------------ step 4: commit */}
          {job.status === "ANALYSED" && (
            <Card title="Commit to the registry" className="border-accent/30"
              subtitle="The first point at which anything is written">
              <div className="space-y-3">
                <p className="t-body">
                  <strong>{(analysis.accepted + analysis.review).toLocaleString()} rows</strong> will
                  be written — {analysis.accepted.toLocaleString()} ready for verification and{" "}
                  {analysis.review.toLocaleString()} marked needs-review. The{" "}
                  {analysis.excluded.toLocaleString()} excluded rows are not written, and stay here
                  with their reasons.
                </p>
                <p className="t-small text-muted leading-relaxed">
                  A row matching a pharmacy you already hold — same state licence, same NPI, or the
                  same name at the same ZIP — updates that record rather than creating a second one.
                  {job.sourceType === "STATE_BOARD"
                    ? " As a state board file, it may correct values the registry already holds."
                    : " As a non-board file, it may only fill blanks; it will not overwrite what a board supplied."}
                </p>
                <div className="flex items-center gap-2">
                  <form action={analyse.bind(null, job.id)}>
                    <button className="btn"><Icon name="refresh" size={16} /> Re-run rules</button>
                  </form>
                  <form action={commit.bind(null, job.id)}>
                    <button className="btn btn-primary">
                      <Icon name="check_circle" size={16} /> Commit{" "}
                      {(analysis.accepted + analysis.review).toLocaleString()} rows
                    </button>
                  </form>
                </div>
              </div>
            </Card>
          )}

          {job.status === "COMMITTED" && job.batch && (
            <Card title="Committed" subtitle={`Import batch #${job.batch.id}`}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Stat label="New records" value={job.batch.recordsAccepted} />
                <Stat label="Updated" value={job.batch.recordsUpdated} />
                <Stat label="Unchanged" value={job.batch.recordsUnchanged} />
                <Stat label="Needs review" value={job.batch.recordsReviewRequired} />
              </div>
              <div className="flex gap-2 mt-3">
                <Link href="/verification" className="btn btn-primary">
                  <Icon name="verified" size={16} /> Go to verification
                </Link>
                <Link href="/data/batches" className="btn">Batch history</Link>
              </div>
            </Card>
          )}
        </>
      )}

      <Card title="Declared columns" className="t-small text-muted">
        <div className="flex flex-wrap gap-1.5">
          {declared.map((c, i) => (
            <span key={`${c}-${i}`} className="badge tone-neutral font-mono normal-case">{c}</span>
          ))}
        </div>
        {job.fileName && (
          <p className="mt-3 pt-3 hairline">
            {job.fileName} · {job.fileFormat} · {((job.fileBytes ?? 0) / 1024).toFixed(0)} KB ·
            sha256 {job.contentHash?.slice(0, 16)}…
          </p>
        )}
      </Card>
    </>
  );
}
