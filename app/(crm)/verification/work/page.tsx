import Link from "next/link";
import { requirePagePermission } from "@/lib/auth";
import { DIMENSIONS, nextInQueue, queueStats, type DimensionType, type QueueFilter }
  from "@/lib/verification/service";
import { recordVerification, skipRecord } from "@/lib/verification/actions";
import { Badge, Card, Empty, Note, PageHeader, Row, Stat } from "@/components/ui";
import { Icon } from "@/components/icon";
import { prisma } from "@/lib/db";
import { StageBar } from "@/components/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verification workspace" };

/**
 * Working the queue, one record at a time.
 *
 * Everything needed to make the call is on this screen — the board record, where each value came
 * from, and links out to the sources — because an operator who has to go hunting for context will
 * guess instead, and a guessed verification is worse than none.
 */
export default async function VerificationWork({ searchParams }: {
  searchParams: Promise<{
    state?: string | string[]; dimension?: string; review?: string; q?: string;
    skipped?: string; done?: string; status?: string; error?: string;
  }>;
}) {
  await requirePagePermission("verification.manage");
  const sp = await searchParams;

  const states = sp.state ? (Array.isArray(sp.state) ? sp.state : [sp.state]) : [];
  const filter: QueueFilter = {
    states,
    dimension: sp.dimension as DimensionType | undefined,
    onlyNeedsReview: sp.review === "1",
    search: sp.q,
  };
  const skipped = (sp.skipped ?? "").split(",").map(Number).filter(Boolean);

  const [current, stats, allStates] = await Promise.all([
    nextInQueue(filter, skipped),
    queueStats(filter),
    prisma.pharmacy.groupBy({ by: ["state"], _count: true, orderBy: { state: "asc" } }),
  ]);

  // Carried on every link and form so the queue keeps its shape across actions.
  const query = new URLSearchParams();
  for (const s of states) query.append("state", s);
  if (sp.dimension) query.set("dimension", sp.dimension);
  if (sp.review) query.set("review", sp.review);
  if (sp.q) query.set("q", sp.q);
  if (sp.skipped) query.set("skipped", sp.skipped);
  const queryString = query.toString();

  const p = current?.pharmacy;
  const mapsUrl = p
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        [p.canonicalName, p.streetAddress, p.city, p.state, p.zipCode].filter(Boolean).join(", "))}`
    : "";

  return (
    <>
      <PageHeader title="Verification workspace"
        subtitle="One record at a time. A record becomes verified only when its licence, ownership and trading status are all confirmed — and only a verified record can ever be sent to."
        actions={<Link href="/verification" className="btn btn-sm">Queue overview</Link>} />
      <StageBar stage="verify" />

      {sp.error && <Note tone="bad">{sp.error}</Note>}
      {sp.done && (
        <Note tone={sp.status === "VERIFIED" ? "ok" : sp.status === "EXCLUDED" ? "bad" : "warn"}>
          Record #{sp.done} is now <strong>{(sp.status ?? "").replace(/_/g, " ").toLowerCase()}</strong>.
          {sp.status === "VERIFIED" && " It is eligible for outreach as soon as its email is verified."}
          {sp.status === "EXCLUDED" && " It has dropped out of every campaign."}
          {sp.status === "NEEDS_REVIEW" && " Something is still unresolved, so it stays out of outreach."}
        </Note>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        <Stat label="Left in this queue" value={stats.remaining}
          icon={<Icon name="fact_check" size={18} />} />
        <Stat label="Checks recorded today" value={stats.doneToday}
          tone={stats.doneToday ? "ok" : undefined} />
        <Stat label="Verified so far" value={stats.verifiedTotal}
          tone={stats.verifiedTotal ? "ok" : "warn"} />
        <Stat label="Fully eligible" value={stats.eligibleTotal}
          hint="verified and a valid email" tone={stats.eligibleTotal ? "ok" : undefined} />
        <Stat label="Skipped this session" value={skipped.length} />
      </div>

      {/* ------------------------------------------------------------------ queue filter */}
      <Card title="Work on" subtitle="Narrows the queue; the order still puts the most useful first">
        <form className="flex flex-wrap items-end gap-3">
          <fieldset>
            <legend className="t-small text-muted mb-1.5">State</legend>
            <div className="flex flex-wrap gap-1.5">
              {allStates.filter((s) => s.state).map((s) => (
                <label key={s.state}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1
                    cursor-pointer hover:border-accent/40 transition-colors">
                  <input type="checkbox" name="state" value={s.state!}
                    defaultChecked={states.includes(s.state!)} />
                  <span className="t-small font-medium">{s.state}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="block t-small text-muted mb-1">Outstanding check</span>
            <select name="dimension" defaultValue={sp.dimension ?? ""} className="inp">
              <option value="">Any</option>
              {DIMENSIONS.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block t-small text-muted mb-1">Name, city or licence</span>
            <input name="q" defaultValue={sp.q ?? ""} className="inp w-52" placeholder="optional" />
          </label>
          <label className="flex items-center gap-2 t-small pb-1.5">
            <input type="checkbox" name="review" value="1" defaultChecked={sp.review === "1"} />
            Only records flagged for review
          </label>
          <button className="btn">Apply</button>
          {queryString && <Link href="/verification/work" className="btn btn-sm">Reset</Link>}
        </form>
      </Card>

      {!current || !p ? (
        <Card>
          <Empty action={<Link href="/verification" className="btn btn-primary">Queue overview</Link>}>
            {skipped.length
              ? "Nothing left in this queue that you have not skipped. Reset the filter to start again."
              : "Nothing left in this queue. Either everything here is verified, or the filter is too narrow."}
          </Empty>
        </Card>
      ) : (
        <form action={recordVerification.bind(null, p.id)} className="grid lg:grid-cols-[1fr_420px] gap-4 items-start">
          <input type="hidden" name="query" value={queryString} />

          {/* ------------------------------------------------------ the record */}
          <div className="space-y-4">
            <Card title={p.canonicalName}
              subtitle={[p.streetAddress, p.city, p.state, p.zipCode].filter(Boolean).join(", ")}
              actions={<Badge value={p.verificationStatus} />}>
              <div className="grid sm:grid-cols-2 gap-x-6">
                <div>
                  <Row label="Licence number" value={p.primaryLicenseNumber ?? "—"} />
                  <Row label="Licence status on file" value={p.licenseStatus ?? "—"} />
                  <Row label="Licence type" value={p.licenseType ?? "—"} />
                  <Row label="County" value={p.county ?? "—"} />
                </div>
                <div>
                  <Row label="Email" value={p.email ?? "none"} />
                  <Row label="Phone" value={p.phone ?? "—"} />
                  <Row label="Owner / PIC" value={p.ownerName ?? p.picName ?? "—"} />
                  <Row label="Locations on this domain" value={p.numberOfLocations ?? "—"} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mt-3 pt-3 hairline">
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                  <Icon name="store" size={15} /> Google Maps
                </a>
                <a href={`https://www.google.com/search?q=${encodeURIComponent(
                  `"${p.canonicalName}" ${p.city ?? ""} ${p.state ?? ""} pharmacy`)}`}
                  target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                  <Icon name="search" size={15} /> Search the web
                </a>
                {p.email && (
                  <a href={`https://${p.email.split("@")[1]}`} target="_blank"
                    rel="noopener noreferrer" className="btn btn-sm">
                    <Icon name="link" size={15} /> {p.email.split("@")[1]}
                  </a>
                )}
                <Link href={`/pharmacies/${p.id}`} className="btn btn-sm">
                  <Icon name="visibility" size={15} /> Full record
                </Link>
              </div>

              {p.exclusionReason && (
                <div className="mt-3 pt-3 hairline">
                  <span className="badge tone-warn">flagged</span>
                  <span className="t-small text-muted ml-2">{p.exclusionReason}</span>
                </div>
              )}
            </Card>

            {/* ------------------------------------------------ the checks */}
            {DIMENSIONS.map((d) => (
              <Card key={d.type} title={d.label} subtitle={d.help}>
                <div className="space-y-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {(["CONFIRMED", "FAILED", "UNCERTAIN"] as const).map((v) => (
                      <label key={v}
                        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5
                          cursor-pointer hover:border-accent/40 transition-colors">
                        <input type="radio" name={`verdict_${d.type}`} value={v} />
                        <span className="t-small">
                          {v === "CONFIRMED" ? "Confirmed" : v === "FAILED" ? "Failed" : "Can't tell"}
                        </span>
                      </label>
                    ))}
                  </div>

                  {d.options.length > 0 && (
                    <label className="block">
                      <span className="block t-small text-muted mb-1">
                        What you found <span className="text-muted">· used when confirmed</span>
                      </span>
                      <select name={`value_${d.type}`} className="inp w-full max-w-xs"
                        defaultValue={
                          d.field === "licenseStatus" ? (p.licenseStatus ?? "")
                          : d.field === "ownershipStatus" ? (p.ownershipStatus ?? "")
                          : d.field === "operationalStatus" ? (p.operationalStatus ?? "")
                          : d.field === "pharmacyType" ? (p.pharmacyType ?? "") : ""}>
                        <option value="">—</option>
                        {d.options.map((o) => (
                          <option key={o} value={o}>{o.replace(/_/g, " ").toLowerCase()}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  <input name={`notes_${d.type}`} className="inp w-full"
                    placeholder="Note, optional" />
                </div>
              </Card>
            ))}
          </div>

          {/* ------------------------------------------------------ evidence and actions */}
          <div className="space-y-4 lg:sticky lg:top-[5.5rem]">
            <Card title="Evidence" subtitle="Recorded against everything you confirm here">
              <div className="space-y-2.5">
                <label className="block">
                  <span className="block t-small text-muted mb-1">Where you checked</span>
                  <input name="evidenceSource" className="inp w-full"
                    placeholder="e.g. Ohio Board licence lookup" />
                </label>
                <label className="block">
                  <span className="block t-small text-muted mb-1">Link</span>
                  <input name="evidenceUrl" type="url" className="inp w-full"
                    placeholder="https://…" />
                </label>
                <label className="block">
                  <span className="block t-small text-muted mb-1">
                    Record note <span className="text-muted">· goes into the deliverable</span>
                  </span>
                  <textarea name="recordNotes" rows={3} className="inp w-full"
                    defaultValue={p.notes ?? ""} placeholder="Anything the client should know" />
                </label>
              </div>

              <div className="flex flex-wrap gap-2 mt-3.5 pt-3.5 hairline">
                <button className="btn btn-primary">
                  <Icon name="check_circle" size={16} /> Save and next
                </button>
                <button formAction={skipRecord.bind(null, p.id)} className="btn" formNoValidate>
                  Skip
                </button>
              </div>
              <input type="hidden" name="skipped" value={sp.skipped ?? ""} />

              <p className="t-small text-muted mt-3 leading-relaxed">
                Leave a check untouched and it stays as it was. A record reaches{" "}
                <strong>verified</strong> only when licence, ownership and trading status are all
                confirmed; any <strong>failed</strong> excludes it outright, and any{" "}
                <strong>can&apos;t tell</strong> holds it in review.
              </p>
            </Card>

            {current.history.length > 0 && (
              <Card title="Already checked" subtitle="Most recent first">
                <ul className="space-y-2">
                  {current.history.slice(0, 8).map((h) => (
                    <li key={h.id} className="t-small">
                      <div className="flex items-center gap-2">
                        <Badge value={h.result} />
                        <span className="font-medium">
                          {h.verificationType.replace(/_/g, " ").toLowerCase()}
                        </span>
                        <span className="text-muted ml-auto">
                          {h.verifiedAt.toISOString().slice(0, 10)}
                        </span>
                      </div>
                      <div className="text-muted mt-0.5">
                        {h.verifiedBy}
                        {h.evidenceSource ? ` · ${h.evidenceSource}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card title="Where these values came from" className="t-small text-muted">
              {p.provenance.length === 0 ? (
                <p>No provenance recorded for this record.</p>
              ) : (
                <ul className="space-y-1">
                  {p.provenance.slice(0, 10).map((v) => (
                    <li key={v.id} className="flex justify-between gap-2">
                      <span>{v.field.replace(/_/g, " ")}</span>
                      <span className="text-ink truncate max-w-[180px]">{v.sourceType}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </form>
      )}
    </>
  );
}
