import { requirePagePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Empty } from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-1 border-b border-line/40 last:border-0">
      <dt className="w-40 shrink-0 text-[12px] text-muted">{label}</dt>
      <dd className={`text-[13px] ${mono ? "tabular-nums" : ""}`}>
        {value || <span className="text-muted">—</span>}
      </dd>
    </div>
  );
}

export default async function PharmacyDetail({ params }: { params: Promise<{ id: string }> }) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("registry.view");
  const { id } = await params;
  const pharmacyId = Number(id);
  if (!Number.isFinite(pharmacyId)) notFound();

  const [p, contacts, provenance, changes, tasks, identifiers] = await Promise.all([
    prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      include: { importBatch: true, assignedMailbox: true,
                 conversations: { select: { id: true }, take: 1, orderBy: { id: "desc" } } },
    }),
    prisma.pharmacyContact.findMany({ where: { pharmacyId }, orderBy: { role: "asc" } }),
    prisma.fieldProvenance.findMany({
      where: { pharmacyId }, orderBy: [{ field: "asc" }, { authorityRank: "asc" }] }),
    prisma.fieldChange.findMany({
      where: { pharmacyId }, orderBy: { detectedAt: "desc" }, take: 25 }),
    prisma.verificationTask.findMany({ where: { pharmacyId }, orderBy: { verificationType: "asc" } }),
    prisma.pharmacyIdentifier.findMany({ where: { pharmacyId } }),
  ]);
  if (!p) notFound();

  // Group provenance by field so conflicting source values sit side by side.
  const byField = new Map<string, typeof provenance>();
  for (const row of provenance) {
    if (!byField.has(row.field)) byField.set(row.field, []);
    byField.get(row.field)!.push(row);
  }
  const conflicts = [...byField.entries()]
    .filter(([, rows]) => new Set(rows.map((r) => r.value)).size > 1);
  const sources = [...new Set(provenance.map((r) => r.sourceId))];

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/pharmacies" className="text-[12px] text-accent hover:underline">← Pharmacies</Link>
          <h1 className="text-lg font-semibold mt-1">{p.canonicalName}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge value={p.dataStatus} />
            <Badge value={p.verificationStatus} />
            <Badge value={p.leadStatus} />
            {p.sourceMissing && <Badge value="SOURCE_MISSING" />}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-3.5">
          <h2 className="text-[13px] font-semibold mb-2">Business</h2>
          <dl>
            <Row label="Name" value={p.canonicalName} />
            <Row label="Doing business as" value={p.doingBusinessAs} />
            <Row label="Type" value={p.pharmacyType} />
            <Row label="Locations" value={p.numberOfLocations?.toString()} mono />
            <Row label="Owner / buyer / PIC" value={p.ownerName ?? p.picName} />
          </dl>
        </div>

        <div className="card p-3.5">
          <h2 className="text-[13px] font-semibold mb-2">Address</h2>
          <dl>
            <Row label="Street" value={p.streetAddress} />
            <Row label="Line 2" value={p.addressLine2} />
            <Row label="City" value={p.city} />
            <Row label="County" value={p.county} />
            <Row label="State / ZIP" value={[p.state, p.zipCode].filter(Boolean).join(" ")} mono />
          </dl>
          {p.streetAddress && (
            <a className="btn mt-2 text-[12px]" target="_blank" rel="noopener noreferrer"
               href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                 [p.canonicalName, p.streetAddress, p.city, p.state, p.zipCode].filter(Boolean).join(", "))}`}>
              Open in Google Maps ↗
            </a>
          )}
        </div>

        <div className="card p-3.5">
          <h2 className="text-[13px] font-semibold mb-2">Contact</h2>
          <dl>
            <Row label="Phone" value={p.phone} mono />
            <Row label="Email" value={p.email} />
            <Row label="Website" value={p.website} />
          </dl>
          <div className="mt-2 pt-2 border-t border-line text-[12px] text-muted">
            Email status: <Badge value={p.emailVerificationStatus} /> — no verifier has run.
          </div>

          <div className="mt-2 pt-2 border-t border-line text-[12px]">
            <div className="text-muted mb-1">Outreach sender</div>
            {p.assignedMailbox ? (
              <>
                <div className="font-medium">{p.assignedMailbox.emailAddress}</div>
                <p data-ui="description" className="text-[11px] text-muted mt-0.5 leading-relaxed">
                  This pharmacy hears from this address. Later campaigns reuse it, and replies are
                  answered from it — unless it becomes unusable, in which case the reroute is
                  written to the audit log.
                </p>
              </>
            ) : (
              <p data-ui="description" className="text-[11px] text-muted leading-relaxed">
                Not yet assigned. The first successful send records which mailbox owns this
                relationship, and every later message uses the same one.
              </p>
            )}
            {p.conversations.length > 0 && (
              <Link href={`/inbox/${p.conversations[0].id}`} className="btn btn-sm mt-2">
                Open conversation
              </Link>
            )}
          </div>
        </div>

        <div className="card p-3.5">
          <h2 className="text-[13px] font-semibold mb-2">Identifiers &amp; licence</h2>
          <dl>
            <Row label="State licence" value={p.primaryLicenseNumber} mono />
            <Row label="Licence status" value={p.licenseStatus} />
            <Row label="Licence type" value={p.licenseType} />
            <Row label="NPI" value={p.npi} mono />
            <Row label="NCPDP ID" value={p.ncpdpId} mono />
          </dl>
          {identifiers.length > 0 && (
            <div className="mt-2 pt-2 border-t border-line text-[12px] text-muted">
              {identifiers.length} recorded identifier{identifiers.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>

      {/* ---- source evidence: mandatory per the brief ---------------------------- */}
      <div className="card p-3.5">
        <h2 className="text-[13px] font-semibold mb-2">Source evidence</h2>
        {sources.length === 0 ? <Empty>No provenance recorded for this record.</Empty> : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {sources.map((s) => <span key={s} className="badge tone-neutral">{s}</span>)}
              {p.importBatch && (
                <Link href={`/data/batches`} className="badge tone-info hover:underline">
                  batch #{p.importBatch.id}
                </Link>
              )}
            </div>
            <table className="tbl">
              <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Rank</th><th>Selected</th><th>Retrieved</th></tr></thead>
              <tbody>
                {provenance.map((r) => (
                  <tr key={r.id} className={r.isSelected ? "" : "opacity-60"}>
                    <td className="text-muted">{r.field}</td>
                    <td className="max-w-[280px] truncate">{r.value ?? "—"}</td>
                    <td className="text-muted">{r.sourceId}</td>
                    <td className="tabular-nums text-muted">{r.authorityRank}</td>
                    <td>{r.isSelected
                      ? <span className="badge tone-ok">selected</span>
                      : <span className="text-muted text-[11px]">kept</span>}</td>
                    <td className="text-muted tabular-nums">{r.retrievedAt.toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {conflicts.length > 0 && (
        <div className="card p-3.5 border-warn/30">
          <h2 className="text-[13px] font-semibold mb-2 text-warn">
            Source conflicts ({conflicts.length})
          </h2>
          <p className="text-[12px] text-muted mb-2">
            Sources disagree on these fields. The higher-authority value is used; the others are
            kept, not discarded.
          </p>
          {conflicts.map(([field, rows]) => (
            <div key={field} className="py-1.5 border-b border-line/40 last:border-0">
              <div className="text-[12px] text-muted mb-0.5">{field}</div>
              {rows.map((r) => (
                <div key={r.id} className="flex gap-2 text-[13px] items-baseline">
                  <span className={r.isSelected ? "text-ok" : "text-muted"}>
                    {r.isSelected ? "●" : "○"}
                  </span>
                  <span className="flex-1">{r.value ?? "—"}</span>
                  <span className="text-[11px] text-muted">{r.sourceId} (rank {r.authorityRank})</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-3.5">
          <h2 className="text-[13px] font-semibold mb-2">Verification</h2>
          {tasks.length === 0 ? <Empty>No verification tasks.</Empty> : (
            <table className="tbl">
              <thead><tr><th>Dimension</th><th>Status</th><th>Trigger</th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.verificationType.replace(/_/g, " ").toLowerCase()}</td>
                    <td><Badge value={t.status} /></td>
                    <td className="text-muted text-[12px]">{t.trigger.replace(/_/g, " ").toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-3.5">
          <h2 className="text-[13px] font-semibold mb-2">Change history</h2>
          {changes.length === 0 ? <Empty>No recorded changes.</Empty> : (
            <div className="space-y-1.5">
              {changes.map((c) => (
                <div key={c.id} className="text-[13px] py-1 border-b border-line/40 last:border-0">
                  <div className="flex justify-between">
                    <span className="text-muted">{c.field}</span>
                    <span className="text-[11px] text-muted tabular-nums">
                      {c.detectedAt.toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <div className="flex gap-2 items-baseline">
                    <span className="text-bad/80 line-through">{c.oldValue ?? "—"}</span>
                    <span className="text-muted">→</span>
                    <span className="text-ok">{c.newValue ?? "—"}</span>
                  </div>
                  <div className="text-[11px] text-muted">{c.sourceId}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {contacts.length > 0 && (
        <div className="card p-3.5">
          <h2 className="text-[13px] font-semibold mb-2">Contacts ({contacts.length})</h2>
          <table className="tbl">
            <thead><tr><th>Role</th><th>Name</th><th>Email</th><th>Phone</th><th>Email status</th><th>Source</th></tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td><span className="badge tone-neutral">{c.role.toLowerCase()}</span></td>
                  <td>{c.name ?? "—"}</td>
                  <td>{c.email ?? <span className="text-muted">—</span>}</td>
                  <td className="tabular-nums">{c.phone ?? <span className="text-muted">—</span>}</td>
                  <td><Badge value={c.emailStatus} /></td>
                  <td className="text-muted text-[12px]">{c.sourceId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
