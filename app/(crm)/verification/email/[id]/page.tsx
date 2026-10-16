import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { applyResults, cancelBatch, submitToProvider, pollProvider } from "@/lib/verify/actions";
import { config } from "@/lib/config";
import { Badge, Card, Empty, Note, PageHeader, Row, Stat } from "@/components/ui";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verification round" };

export default async function VerificationBatch({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; applied?: string; unmatched?: string;
                          submitted?: string; polled?: string;
                          created?: string; skipped?: string }>;
}) {
  await requirePagePermission("verification.manage");
  const { id } = await params;
  const sp = await searchParams;

  const batch = await prisma.emailVerificationBatch.findUnique({ where: { id: Number(id) } });
  if (!batch) notFound();

  const [byResult, sample] = await Promise.all([
    prisma.emailVerificationItem.groupBy({
      by: ["result"], where: { batchId: batch.id }, _count: true }),
    prisma.emailVerificationItem.findMany({
      where: { batchId: batch.id }, orderBy: { id: "asc" }, take: 25,
      include: { pharmacy: { select: { canonicalName: true, state: true } } },
    }),
  ]);
  const n = (r: string) => byResult.find((x) => x.result === r)?._count ?? 0;
  const meta = batch.providerMeta as
    { submitted?: number; duplicatesRemoved?: number; rejected?: number } | null;
  const configured = Boolean(config.verifier.apiKey);
  const scope = batch.scope as { states?: string[]; emailKinds?: string[]; limit?: number };
  const done = batch.status === "APPLIED";

  return (
    <>
      <Link href="/verification/email" className="text-[12px] link">← Email verification</Link>
      <PageHeader title={batch.name}
        subtitle={`${batch.total.toLocaleString()} addresses${scope.states?.length ? ` · ${scope.states.join(", ")}` : " · every state"}${scope.emailKinds?.length ? ` · ${scope.emailKinds.join(", ").toLowerCase()}` : ""}`}
        actions={batch.status !== "APPLIED" && batch.status !== "CANCELLED" ? (
          <form action={cancelBatch.bind(null, batch.id)}>
            <button className="btn btn-danger btn-sm">Cancel and release</button>
          </form>
        ) : undefined}>
        <div className="mt-2"><Badge value={batch.status} /></div>
      </PageHeader>

      {sp.error && <Note tone="bad">{sp.error}</Note>}
      {sp.skipped && (
        <Note tone="info">
          <strong>{Number(sp.skipped).toLocaleString()} address
          {Number(sp.skipped) === 1 ? " was" : "es were"} left out of this round.</strong>{" "}
          They are already confirmed valid, and verification is billed per address. To pay for
          them again deliberately, tick &ldquo;valid&rdquo; under previous results, or set a
          staleness window.
        </Note>
      )}

      {sp.submitted && (
        <Note tone="ok">
          Sent to Reoon. Check progress below — the results are written back the moment the task
          completes.
        </Note>
      )}
      {sp.polled && !sp.applied && (
        <Note tone="info">
          The verifier says this round is <strong>{sp.polled}</strong>. Nothing has changed in the
          registry yet; results are applied only when it completes.
        </Note>
      )}
      {sp.applied && (
        <Note tone="ok">
          {Number(sp.applied).toLocaleString()} results applied to the registry.
          {Number(sp.unmatched ?? 0) > 0 && (
            <> {Number(sp.unmatched).toLocaleString()} rows could not be matched to this batch and
            were ignored — check the pharmacy_id or email column in your file.</>
          )}
        </Note>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <Stat label="In this round" value={batch.total} />
        <Stat label="Valid" value={n("VALID")} tone={n("VALID") ? "ok" : undefined} />
        <Stat label="Invalid" value={n("INVALID")} tone={n("INVALID") ? "bad" : undefined} />
        <Stat label="Catch-all" value={n("CATCH_ALL")} hint="domain accepts everything" />
        <Stat label="Risky" value={n("RISKY")} />
        <Stat label="Still waiting" value={n("NOT_CHECKED")} />
      </div>

      {!done && batch.providerTaskId && (
        <Card title="With Reoon" className="border-accent/30"
          subtitle={`Task ${batch.providerTaskId} · ${batch.providerStatus ?? "waiting"}`}>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between t-small mb-1">
                <span className="text-muted">Checked</span>
                <span className="tabular-nums">
                  {batch.checkedCount.toLocaleString()} of {batch.total.toLocaleString()}
                </span>
              </div>
              <div className="h-2 rounded-full bg-line/70 overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${batch.total ? (batch.checkedCount / batch.total) * 100 : 0}%` }} />
              </div>
            </div>

            {meta && (
              <div className="grid sm:grid-cols-3 gap-2 t-small">
                <Row label="Submitted" value={String(meta.submitted ?? "—")} />
                <Row label="Duplicates removed" value={String(meta.duplicatesRemoved ?? 0)} />
                <Row label="Rejected as malformed" value={String(meta.rejected ?? 0)} />
              </div>
            )}

            {batch.error && <Note tone="bad">{batch.error}</Note>}

            <form action={pollProvider.bind(null, batch.id)}>
              <button className="btn btn-primary">
                <Icon name="refresh" size={16} /> Check progress
              </button>
            </form>
            <p data-ui="description" className="t-small text-muted leading-relaxed">
              Reoon processes tasks one at a time, so a large round can wait behind another.
              Checking is free and applies the results automatically once the task completes.
              {batch.lastPolledAt && (
                <> Last checked {batch.lastPolledAt.toISOString().slice(0, 16).replace("T", " ")}.</>
              )}
            </p>
          </div>
        </Card>
      )}

      {!done && !batch.providerTaskId && configured && (
        <Card title="Send this round to Reoon" className="border-accent/30"
          subtitle={`${batch.total.toLocaleString()} addresses`}>
          <form action={submitToProvider.bind(null, batch.id)}>
            <button className="btn btn-primary">
              <Icon name="send" size={16} /> Submit to the verifier
            </button>
          </form>
          <p data-ui="description" className="t-small text-muted mt-3 leading-relaxed">
            Duplicate addresses are removed by the provider before charging, so the cost is the
            number of distinct addresses rather than the row count.
          </p>
        </Card>
      )}

      {!done && !batch.providerTaskId && (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Card title="1 · Send the addresses to your verifier"
            subtitle="Downloads the batch as CSV — pharmacy_id, email, name, state">
            <a href={`/api/verify/export?batch=${batch.id}`} className="btn btn-primary">
              <Icon name="upload_file" size={16} /> Download the CSV
            </a>
            <p data-ui="description" className="t-small text-muted mt-3 leading-relaxed">
              Any verifier will do — Bouncer, ZeroBounce, NeverBounce. Keep the{" "}
              <code>pharmacy_id</code> column in the file they give you back and the results match
              themselves up; an email column works too.
            </p>
            {!config.verifier.apiKey && (
              <p data-ui="description" className="t-small text-muted mt-2 pt-2 hairline leading-relaxed">
                No verifier API key is configured, so this round is a file exchange. Set{" "}
                <code>EMAIL_VERIFIER_API_KEY</code> and the same batch runs automatically instead —
                nothing else about the flow changes.
              </p>
            )}
          </Card>

          <Card title="2 · Bring the results back"
            subtitle="Paste the verifier's CSV, including its header row">
            <form action={applyResults.bind(null, batch.id)} className="space-y-3">
              <textarea name="results" rows={8} required
                className="input font-mono text-[0.8125rem]"
                placeholder={"pharmacy_id,email,result\n1234,owner@rx.com,valid\n1235,info@rx.com,catch_all"} />
              <button className="btn btn-primary">
                <Icon name="check_circle" size={16} /> Apply to the registry
              </button>
            </form>
            <p data-ui="description" className="t-small text-muted mt-3 pt-3 hairline leading-relaxed">
              Only <strong>valid</strong> makes an address eligible for outreach. Catch-all means
              the domain accepts everything and proves nothing, so it stays out — as does risky.
              Anything the verifier did not answer for returns to unchecked rather than being
              guessed at.
            </p>
          </Card>
        </div>
      )}

      <Card pad={false} title="Addresses in this round" className="overflow-x-auto">
        {sample.length === 0 ? <Empty>This round has no addresses.</Empty> : (
          <>
            <table className="tbl">
              <thead><tr>
                <th>Pharmacy</th><th>State</th><th>Address</th><th>Result</th><th>Verifier said</th>
              </tr></thead>
              <tbody>
                {sample.map((i) => (
                  <tr key={i.id}>
                    <td className="max-w-[260px]">
                      <Link href={`/pharmacies/${i.pharmacyId}`} className="link">
                        {i.pharmacy.canonicalName}
                      </Link>
                    </td>
                    <td>{i.pharmacy.state ?? "—"}</td>
                    <td className="max-w-[240px] truncate">{i.email}</td>
                    <td><Badge value={i.result} /></td>
                    <td className="t-small text-muted">{i.detail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {batch.total > sample.length && (
              <p className="t-small text-muted px-4 py-2.5">
                Showing {sample.length} of {batch.total.toLocaleString()}.
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
