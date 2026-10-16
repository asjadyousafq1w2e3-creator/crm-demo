import { requirePagePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Batches() {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("registry.view");
  const batches = await prisma.importBatch.findMany({
    orderBy: { id: "desc" },
    include: { _count: { select: { pharmacies: true } } },
  });

  return (
    <>
      <PageHeader title="Import batches"
        subtitle="Every dataset entering the master registry, with its record accounting." />

      <Card title="Batch history" subtitle="Every dataset that entered the master registry" pad={false} className="overflow-x-auto">
        {batches.length === 0 ? <Empty>No import batches yet.</Empty> : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th><th>Label</th><th>Source</th><th>Dataset date</th><th>Received</th>
                <th>New</th><th>Changed</th><th>Unchanged</th><th>Rejected</th>
                <th>Dupes prevented</th><th>Status</th><th>Imported</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="tabular-nums text-muted">{b.id}</td>
                  <td className="max-w-[220px]">
                    <Link href={`/pharmacies?batch=${b.id}`} className="text-accent hover:underline">
                      {b.label}
                    </Link>
                    {b.detail && <div className="text-[11px] text-muted mt-0.5">{b.detail}</div>}
                  </td>
                  <td className="text-muted">{b.source}</td>
                  <td className="tabular-nums text-muted">{b.datasetDate ?? "—"}</td>
                  <td className="tabular-nums">{b.recordsReceived.toLocaleString()}</td>
                  <td className="tabular-nums">{b.recordsAccepted.toLocaleString()}</td>
                  <td className="tabular-nums">{b.recordsUpdated.toLocaleString()}</td>
                  <td className="tabular-nums text-muted">{b.recordsUnchanged.toLocaleString()}</td>
                  <td className="tabular-nums">{b.recordsRejected.toLocaleString()}</td>
                  <td className="tabular-nums">{b.duplicatesPrevented.toLocaleString()}</td>
                  <td><Badge value={b.status} /></td>
                  <td className="text-muted tabular-nums">
                    {b.completedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
