import Link from "next/link";
import { requirePagePermission } from "@/lib/auth";
import { rescreenRegistry, type Finding } from "@/lib/import/rescreen";
import { applyRescreenAction } from "@/lib/import/rescreen-actions";
import { RULES } from "@/lib/import/engine";
import { Card, Empty, Note, PageHeader, Stat } from "@/components/ui";
import { HBars } from "@/components/charts";
import { Icon } from "@/components/icon";
import { StageBar } from "@/components/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Re-screen the registry" };

const LABEL: Record<string, string> = {
  ...Object.fromEntries(RULES.map((r) => [r.id, r.label])),
  "shared-contact": "One mailbox across many locations",
  "shared-domain": "One company domain across many locations",
};

/**
 * Applying today's rules to records admitted under yesterday's.
 *
 * Rules improve. When they do, everything already in the registry has to be re-examined - a chain
 * that slipped through once otherwise stays in every campaign until somebody goes looking for it.
 */
export default async function Rescreen({ searchParams }: {
  searchParams: Promise<{ excluded?: string; flagged?: string; show?: string }>;
}) {
  await requirePagePermission("verification.manage");
  const sp = await searchParams;
  const report = await rescreenRegistry();
  const show = sp.show === "review" ? "review" : "exclude";
  const rows: Finding[] = show === "review" ? report.review : report.exclude;

  const byRule = Object.entries(report.byRule)
    .map(([rule, count]) => ({ label: LABEL[rule] ?? rule, value: count }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHeader title="Re-screen the registry"
        subtitle="Runs today's inclusion and exclusion rules over every record already held, and reports what would change. Nothing is altered until you apply it." />
      <StageBar stage="screen" />

      {(sp.excluded || sp.flagged) && (
        <Note tone="ok">
          {Number(sp.excluded ?? 0).toLocaleString()} records excluded
          {sp.flagged ? ` and ${Number(sp.flagged).toLocaleString()} sent to review` : ""}.
          Excluded records keep every field and every provenance row — they are marked, not
          removed, so the decision stays visible and reversible.
        </Note>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="Records scanned" value={report.scanned} />
        <Stat label="Would be excluded" value={report.exclude.length}
          tone={report.exclude.length ? "bad" : "ok"}
          icon={<Icon name="block" size={18} />} />
        <Stat label="Would go to review" value={report.review.length}
          tone={report.review.length ? "warn" : undefined} />
        <Stat label="Unaffected"
          value={report.scanned - report.exclude.length - report.review.length} tone="ok" />
      </div>

      {report.exclude.length === 0 && report.review.length === 0 ? (
        <Note tone="ok">
          Every record in the registry passes the current rules. Nothing to do.
        </Note>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="What the rules caught"
              subtitle="Counted across both exclusions and reviews">
              <HBars data={byRule} unit="records" empty="Nothing caught." />
            </Card>

            <Card title="Apply these decisions" className="border-bad/25"
              subtitle="Excluded records are marked, never deleted">
              <form action={applyRescreenAction} className="space-y-3">
                <p className="t-body">
                  <strong>{report.exclude.length.toLocaleString()} records</strong> would be marked
                  excluded and drop out of every campaign immediately.
                </p>
                <label className="flex items-start gap-2.5 t-small">
                  <input type="checkbox" name="applyReview" defaultChecked className="mt-0.5" />
                  <span>
                    Also send the {report.review.length.toLocaleString()} uncertain records to
                    Needs Review
                    <span className="block text-muted mt-0.5">
                      Ownership could not be settled from the data. They stay out of outreach until
                      somebody confirms them either way.
                    </span>
                  </span>
                </label>
                <button className="btn btn-danger">
                  <Icon name="rule" size={16} /> Apply to the registry
                </button>
                <p data-ui="description" className="t-small text-muted leading-relaxed">
                  Every change is audited, and every excluded record keeps its exclusion reason, so
                  a wrong call can be found and reversed.
                </p>
              </form>
            </Card>
          </div>

          <Card pad={false} title="The records themselves"
            actions={
              <div className="flex gap-1">
                <Link href="?show=exclude"
                  className={`btn btn-sm ${show === "exclude" ? "btn-primary" : ""}`}>
                  Exclude ({report.exclude.length.toLocaleString()})
                </Link>
                <Link href="?show=review"
                  className={`btn btn-sm ${show === "review" ? "btn-primary" : ""}`}>
                  Review ({report.review.length.toLocaleString()})
                </Link>
              </div>
            }>
            {rows.length === 0 ? <Empty>Nothing in this category.</Empty> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr>
                    <th>Pharmacy</th><th>State</th><th>Email</th><th>Rule</th><th>Why</th>
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, 100).map((f) => (
                      <tr key={f.pharmacyId}>
                        <td className="max-w-[250px]">
                          <Link href={`/pharmacies/${f.pharmacyId}`} className="link">
                            {f.name}
                          </Link>
                        </td>
                        <td>{f.state ?? "—"}</td>
                        <td className="max-w-[200px] truncate t-small text-muted">
                          {f.email ?? "—"}
                        </td>
                        <td className="t-small">{LABEL[f.rule] ?? f.rule}</td>
                        <td className="t-small text-muted max-w-[340px]">{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 100 && (
                  <p className="t-small text-muted px-4 py-2.5">
                    Showing the first 100 of {rows.length.toLocaleString()}.
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
