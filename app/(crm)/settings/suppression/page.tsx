import { requirePagePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, Empty, Note, PageHeader, Pager } from "@/components/ui";
import { addSuppression, removeSuppression } from "@/lib/settings-actions";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function Suppression({ searchParams }: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("suppression.manage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = sp.q ? { email: { contains: sp.q.toLowerCase() } } : {};
  const [total, rows, byReason] = await Promise.all([
    prisma.suppressionEntry.count({ where }),
    prisma.suppressionEntry.findMany({
      where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.suppressionEntry.groupBy({ by: ["reason"], _count: true }),
  ]);

  return (
    <>
      <PageHeader title="Suppression list"
        subtitle="Global. An address here cannot be mailed by any campaign, now or after a re-import." />

      <Note tone="neutral">
        Suppression survives everything: a new campaign, a re-import, a different pharmacy record
        carrying the same address. An <code>unsubscribed</code> entry cannot be removed here at
        all — an operator must not be able to undo someone&apos;s opt-out with a click.
      </Note>

      <div className="flex flex-wrap gap-2 text-[12px]">
        {byReason.map((r) => (
          <span key={r.reason} className="badge tone-neutral">
            {r.reason.toLowerCase()} {r._count.toLocaleString()}
          </span>
        ))}
      </div>

      <Card title="Add an address"
        subtitle="Blocks it across every campaign, immediately and permanently">
        <form action={addSuppression} className="flex flex-wrap items-end gap-2">
          <input name="email" required placeholder="address@example.com" className="inp w-64" />
          <select name="reason" className="inp" defaultValue="MANUAL_BLOCK">
            {["MANUAL_BLOCK", "COMPLAINT", "UNSUBSCRIBED", "BOUNCED"].map((r) => (
              <option key={r} value={r}>{r.toLowerCase()}</option>
            ))}
          </select>
          <input name="notes" placeholder="Note (optional)" className="inp w-64" />
          <button className="btn">Suppress</button>
        </form>
      </Card>

      <form className="flex gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search address" className="inp w-64" />
        <button className="btn">Search</button>
      </form>

      <Card title="Suppressed addresses" pad={false} className="overflow-x-auto">
        {rows.length === 0 ? <Empty>No suppressed addresses.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Address</th><th>Reason</th><th>Source</th><th>Notes</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-[12px]">{r.email}</td>
                  <td><span className="badge tone-neutral">{r.reason.toLowerCase()}</span></td>
                  <td className="text-[12px] text-muted">{r.source ?? "—"}</td>
                  <td className="text-[11px] text-muted max-w-[280px] truncate">{r.notes ?? "—"}</td>
                  <td className="text-[12px] text-muted tabular-nums">{r.createdAt.toISOString().slice(0, 10)}</td>
                  <td>
                    {r.reason === "UNSUBSCRIBED" ? (
                      <span className="text-[11px] text-muted" title="An unsubscribe cannot be undone from the UI">
                        permanent
                      </span>
                    ) : (
                      <form action={removeSuppression.bind(null, r.id)}>
                        <button className="btn text-[11px]">Remove</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Pager page={page} pages={Math.ceil(total / PAGE)} total={total} params={sp} />
    </>
  );
}
