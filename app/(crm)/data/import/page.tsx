import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { Badge, Card, Empty, Note, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icon";
import { StageBar } from "@/components/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Imports" };

export default async function Imports() {
  await requirePagePermission("verification.manage");
  const jobs = await prisma.importJob.findMany({
    orderBy: { id: "desc" }, take: 50, include: { batch: true } });

  return (
    <>
      <PageHeader title="Imports"
        subtitle="Bring a new dataset into the registry: declare its shape, upload it, see exactly what the rules did to it, then commit."
        actions={
          <Link href="/data/import/new" className="btn btn-primary">
            <Icon name="upload_file" size={16} /> New import
          </Link>
        } />
      <StageBar stage="import" />

      <Note tone="neutral">
        Files of any shape are accepted — different column names, different order, different
        format. What cannot vary is that the file has an email column, and that every row goes
        through the same cleaning and exclusion rules the existing records went through.
      </Note>

      <Card pad={false} className="overflow-x-auto">
        {jobs.length === 0 ? (
          <Empty action={
            <Link href="/data/import/new" className="btn btn-primary">Declare the first dataset</Link>
          }>
            No imports yet. Every dataset that has entered the registry so far came through the
            acquisition pipeline; this is how new ones arrive from here on.
          </Empty>
        ) : (
          <table className="tbl">
            <thead><tr>
              <th>Dataset</th><th>Source</th><th>Status</th><th>Rows</th>
              <th>Result</th><th>Started</th>
            </tr></thead>
            <tbody>
              {jobs.map((j) => {
                const a = j.analysis as { accepted?: number; review?: number; excluded?: number } | null;
                return (
                  <tr key={j.id}>
                    <td>
                      <Link href={`/data/import/${j.id}`} className="link">{j.name}</Link>
                      {j.fileName && (
                        <div className="t-small text-muted truncate max-w-[260px]">{j.fileName}</div>
                      )}
                    </td>
                    <td className="t-small text-muted">
                      {j.sourceType.replace(/_/g, " ").toLowerCase()}
                      {j.jurisdiction && <span className="text-ink"> · {j.jurisdiction}</span>}
                    </td>
                    <td><Badge value={j.status} /></td>
                    <td className="tabular-nums">{(j.totalRows ?? 0).toLocaleString()}</td>
                    <td className="t-small">
                      {a ? (
                        <span className="text-muted">
                          <span className="text-ok">{(a.accepted ?? 0).toLocaleString()} accepted</span>
                          {" · "}{(a.review ?? 0).toLocaleString()} review
                          {" · "}{(a.excluded ?? 0).toLocaleString()} excluded
                        </span>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="t-small text-muted tabular-nums whitespace-nowrap">
                      {j.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
