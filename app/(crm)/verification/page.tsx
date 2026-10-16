import { requirePagePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, Empty, Note, PageHeader, Pager } from "@/components/ui";
import Link from "next/link";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
const PER_PAGE = 50;
type SP = Record<string, string | undefined>;

const STATUSES = ["READY_FOR_VERIFICATION", "IN_VERIFICATION", "VERIFIED", "NEEDS_REVIEW", "EXCLUDED"];

export default async function Verification({ searchParams }: { searchParams: Promise<SP> }) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("registry.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const status = sp.status ?? "READY_FOR_VERIFICATION";

  const where: Prisma.PharmacyWhereInput = { verificationStatus: status };
  if (sp.state) where.state = sp.state;
  if (sp.q?.trim()) where.canonicalName = { contains: sp.q.trim(), mode: "insensitive" };

  const [counts, rows, total, taskCounts, states] = await Promise.all([
    prisma.pharmacy.groupBy({ by: ["verificationStatus"], _count: true }),
    prisma.pharmacy.findMany({
      where, orderBy: { canonicalName: "asc" },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
      select: {
        id: true, canonicalName: true, state: true, pharmacyType: true, email: true,
        phone: true, verificationStatus: true, licenseVerificationStatus: true,
        ownershipVerificationStatus: true, operationalVerificationStatus: true,
        emailVerificationStatus: true,
        _count: { select: { tasks: { where: { status: "NOT_STARTED" } } } },
      },
    }),
    prisma.pharmacy.count({ where }),
    prisma.verificationTask.groupBy({ by: ["verificationType"], _count: true,
      where: { status: "NOT_STARTED" } }),
    prisma.pharmacy.groupBy({ by: ["state"], _count: true, orderBy: { state: "asc" } }),
  ]);
  const pages = Math.ceil(total / PER_PAGE);
  const n = (s: string) => counts.find((c) => c.verificationStatus === s)?._count ?? 0;

  return (
    <>
      <PageHeader title="Verification"
        subtitle="Queue only — no verification has been executed. Nothing here calls an external service." />

      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link key={s} href={`/verification?status=${s}`}
            className={`btn btn-sm ${status === s ? "btn-primary" : ""}`}>
            {s.replace(/_/g, " ").toLowerCase()}
            <span className="text-muted tabular-nums">{n(s).toLocaleString()}</span>
          </Link>
        ))}
      </div>

      <Card title="Open tasks by dimension"
        subtitle="A task is one dimension of one record that a human must confirm">
        <div className="flex flex-wrap gap-1.5">
          {taskCounts.map((t) => (
            <span key={t.verificationType} className="btn cursor-default">
              {t.verificationType.replace(/_/g, " ").toLowerCase()}
              <span className="text-muted tabular-nums">{t._count.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </Card>

      <Note tone="neutral">
        This page reads the queue. To actually work it — confirm a licence, settle ownership, mark
        a shop closed — open the{" "}
        <Link href="/verification/work" className="link">verification workspace</Link>, which takes
        records one at a time and records who checked what, against which source.
      </Note>

      <form className="card p-3 flex flex-wrap gap-2 items-end">
        <input type="hidden" name="status" value={status} />
        <div className="flex-1 min-w-[200px]">
          <label className="text-[11px] text-muted block mb-1">Search</label>
          <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="pharmacy name" />
        </div>
        <div className="w-36">
          <label className="text-[11px] text-muted block mb-1">State</label>
          <select name="state" defaultValue={sp.state ?? ""} className="input">
            <option value="">All</option>
            {states.filter((s) => s.state).map((s) => (
              <option key={s.state} value={s.state!}>{s.state}</option>))}
          </select>
        </div>
        <button className="btn btn-primary">Apply</button>
      </form>

      <Card pad={false} className="overflow-x-auto">
        {rows.length === 0 ? <Empty>Nothing in this queue.</Empty> : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Pharmacy</th><th>State</th><th>Type</th><th>Licence</th><th>Ownership</th>
                <th>Operational</th><th>Email</th><th>Open tasks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[250px]">
                    <Link href={`/pharmacies/${p.id}`} className="text-accent hover:underline">
                      {p.canonicalName}
                    </Link>
                  </td>
                  <td className="tabular-nums">{p.state ?? "—"}</td>
                  <td className="text-muted max-w-[160px] truncate">{p.pharmacyType ?? "—"}</td>
                  <td><Badge value={p.licenseVerificationStatus} /></td>
                  <td><Badge value={p.ownershipVerificationStatus} /></td>
                  <td><Badge value={p.operationalVerificationStatus} /></td>
                  <td><Badge value={p.emailVerificationStatus} /></td>
                  <td className="tabular-nums">{p._count.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Pager page={page} pages={pages} total={total} params={{ ...sp, status }} />
    </>
  );
}
