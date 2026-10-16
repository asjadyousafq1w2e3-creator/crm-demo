import { requirePagePermission, sessionCan } from "@/lib/auth";
import { SelectableRegistry } from "@/components/bulk-select";
import { prisma } from "@/lib/db";
import { Card, Empty, Note, PageHeader, Pager } from "@/components/ui";
import Link from "next/link";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
const PER_PAGE = 50;

type SP = Record<string, string | undefined>;

/** All filtering happens in SQL. The browser never receives the full table. */
function buildWhere(sp: SP): Prisma.PharmacyWhereInput {
  const where: Prisma.PharmacyWhereInput = {};
  const and: Prisma.PharmacyWhereInput[] = [];

  if (sp.state) where.state = sp.state;
  if (sp.city) where.city = { contains: sp.city, mode: "insensitive" };
  if (sp.type) where.pharmacyType = { contains: sp.type, mode: "insensitive" };
  if (sp.verification) where.verificationStatus = sp.verification;
  if (sp.license) where.licenseStatus = { contains: sp.license, mode: "insensitive" };
  if (sp.batch) where.importBatchId = Number(sp.batch);

  if (sp.hasEmail === "yes") and.push({ email: { not: null } });
  if (sp.hasEmail === "no") and.push({ email: null });
  if (sp.hasPhone === "yes") and.push({ phone: { not: null } });
  if (sp.hasPhone === "no") and.push({ phone: null });
  if (sp.hasWebsite === "yes") and.push({ website: { not: null } });

  const q = sp.q?.trim();
  if (q) {
    and.push({
      OR: [
        { canonicalName: { contains: q, mode: "insensitive" } },
        { doingBusinessAs: { contains: q, mode: "insensitive" } },
        { primaryLicenseNumber: { contains: q, mode: "insensitive" } },
        { npi: { contains: q } },
        { ncpdpId: { contains: q } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (and.length) where.AND = and;
  return where;
}

export default async function Pharmacies({ searchParams }: { searchParams: Promise<SP> }) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("registry.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = buildWhere(sp);

  const [rows, total, states, batches] = await Promise.all([
    prisma.pharmacy.findMany({
      where, orderBy: { canonicalName: "asc" },
      skip: (page - 1) * PER_PAGE, take: PER_PAGE,
      select: {
        id: true, canonicalName: true, pharmacyType: true, city: true, state: true,
        phone: true, email: true, primaryLicenseNumber: true, licenseStatus: true,
        dataStatus: true, verificationStatus: true, updatedAt: true,
        emailKind: true, emailVerificationStatus: true,
      },
    }),
    prisma.pharmacy.count({ where }),
    prisma.pharmacy.groupBy({ by: ["state"], _count: true, orderBy: { state: "asc" } }),
    prisma.importBatch.findMany({ where: { status: "OK" }, select: { id: true, label: true } }),
  ]);
  const pages = Math.ceil(total / PER_PAGE);

  const [openCampaigns, permissions] = await Promise.all([
    prisma.campaign.findMany({
      where: { status: { in: ["DRAFT", "READY", "PAUSED", "RUNNING"] } },
      select: { id: true, name: true }, orderBy: { id: "desc" }, take: 25,
    }),
    (async () => ({
      campaign: await sessionCan("campaign.edit"),
      suppression: await sessionCan("suppression.manage"),
      verification: await sessionCan("verification.manage"),
    }))(),
  ]);

  // Bulk actions return the operator to exactly the page and filter they acted from.
  const backParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "done" && k !== "error")
    backParams.set(k, String(v));
  const backHref = `/pharmacies${backParams.toString() ? `?${backParams}` : ""}`;

  const filtered = Object.entries(sp).some(([k, v]) => v && k !== "page");

  return (
    <>
      <PageHeader title="Pharmacies"
        subtitle="Every filter runs in SQL and the page is capped server-side, so the browser never receives the whole table however large the registry grows."
        actions={filtered
          ? <Link href="/pharmacies" className="btn btn-sm">Clear filters</Link>
          : undefined}>
        <p className="text-[13px] mt-1">
          <span className="font-semibold tabular-nums">{total.toLocaleString()}</span>
          <span className="text-muted"> matching records</span>
        </p>
      </PageHeader>

      <form className="card p-3 grid grid-cols-2 md:grid-cols-6 gap-2.5 items-end">
        <div className="col-span-2">
          <label className="text-[11px] text-muted block mb-1">Search</label>
          <input name="q" defaultValue={sp.q ?? ""} className="input"
                 placeholder="name, licence, NPI, phone, email, city" />
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">State</label>
          <select name="state" defaultValue={sp.state ?? ""} className="input">
            <option value="">All</option>
            {states.filter((s) => s.state).map((s) => (
              <option key={s.state} value={s.state!}>{s.state} ({s._count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Verification</label>
          <select name="verification" defaultValue={sp.verification ?? ""} className="input">
            <option value="">All</option>
            {["READY_FOR_VERIFICATION","IN_VERIFICATION","VERIFIED","NEEDS_REVIEW","EXCLUDED"]
              .map((v) => <option key={v} value={v}>{v.replace(/_/g," ").toLowerCase()}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Email</label>
          <select name="hasEmail" defaultValue={sp.hasEmail ?? ""} className="input">
            <option value="">Any</option><option value="yes">Has email</option><option value="no">No email</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Phone</label>
          <select name="hasPhone" defaultValue={sp.hasPhone ?? ""} className="input">
            <option value="">Any</option><option value="yes">Has phone</option><option value="no">No phone</option>
          </select>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="text-[11px] text-muted block mb-1">Batch</label>
          <select name="batch" defaultValue={sp.batch ?? ""} className="input">
            <option value="">All</option>
            {batches.map((b) => <option key={b.id} value={b.id}>#{b.id} {b.label.slice(0, 22)}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit">Apply</button>
          <Link className="btn" href="/pharmacies">Reset</Link>
        </div>
      </form>

      {(sp.done || sp.error) && (
        <Note tone={sp.error ? "bad" : "ok"}>{sp.error ?? sp.done}</Note>
      )}

      <Card pad={false}>
        {rows.length === 0 ? <Empty>No pharmacies match these filters.</Empty> : (
          <SelectableRegistry
            rows={rows.map((p) => ({
              id: p.id, name: p.canonicalName, type: p.pharmacyType,
              city: p.city, state: p.state, email: p.email, emailKind: p.emailKind,
              phone: p.phone, licence: p.primaryLicenseNumber,
              verificationStatus: p.verificationStatus,
              emailVerificationStatus: p.emailVerificationStatus,
              updatedAt: p.updatedAt.toISOString().slice(0, 10),
            }))}
            campaigns={openCampaigns.map((c) => ({ id: c.id, name: c.name }))}
            back={backHref}
            can={permissions} />
        )}
      </Card>

      <Pager page={page} pages={pages} total={total} params={sp} />
    </>
  );
}
