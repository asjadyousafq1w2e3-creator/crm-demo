import { requirePagePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, Empty, PageHeader, Pager } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";
const PAGE = 100;

const TONE = (t: string) =>
  t.includes("FAILED") || t.includes("BOUNCED") || t.includes("AUTO_PAUSED") || t === "EMERGENCY_STOP"
    ? "text-bad"
    : t.includes("SENT") || t.includes("CONNECTED") || t === "LOGIN" ? "text-ok"
    : t.includes("BLOCKED") || t.includes("UNSUBSCRIBED") || t.includes("PAUSED") ? "text-warn"
    : "text-muted";

export default async function Audit({ searchParams }: {
  searchParams: Promise<{ page?: string; type?: string; actor?: string }>;
}) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = {
    ...(sp.type ? { eventType: sp.type } : {}),
    ...(sp.actor ? { actor: sp.actor } : {}),
  };
  const [total, rows, types] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditEvent.groupBy({ by: ["eventType"], _count: true,
      orderBy: { _count: { eventType: "desc" } }, take: 30 }),
  ]);

  return (
    <>
      <PageHeader title="Audit log"
        subtitle="Append-only record of what the system and the operator did. Nothing here is editable or deletable from the application." />

      <div className="flex flex-wrap gap-1.5">
        <Link href="/audit" className={`btn text-[11px] ${!sp.type ? "border-accent text-accent" : ""}`}>
          All
        </Link>
        {types.map((t) => (
          <Link key={t.eventType} href={`/audit?type=${t.eventType}`}
            className={`btn text-[11px] ${sp.type === t.eventType ? "border-accent text-accent" : ""}`}>
            {t.eventType.replace(/_/g, " ").toLowerCase()} {t._count}
          </Link>
        ))}
      </div>

      <Card title="Events" subtitle="Newest first — the log is append-only" pad={false} className="overflow-x-auto">
        {rows.length === 0 ? <Empty>No events recorded.</Empty> : (
          <table className="tbl">
            <thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Pharmacy</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="text-[12px] text-muted tabular-nums whitespace-nowrap">
                    {e.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                  </td>
                  <td className={`text-[12px] ${TONE(e.eventType)}`}>{e.eventType}</td>
                  <td className="text-[12px] text-muted">{e.actor}</td>
                  <td className="text-[12px]">
                    {e.pharmacyId
                      ? <Link href={`/pharmacies/${e.pharmacyId}`} className="text-accent hover:underline">#{e.pharmacyId}</Link>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-[11px] text-muted max-w-[420px] truncate">{e.detail ?? "—"}</td>
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
