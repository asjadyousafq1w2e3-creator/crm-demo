import { requirePagePermission } from "@/lib/auth";
import { buildDeliverable, TABS } from "@/lib/deliverable/build";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Card, Note, PageHeader, Row, Stat } from "@/components/ui";
import { Icon } from "@/components/icon";
import { StageBar } from "@/components/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client deliverable" };

/**
 * The file the client receives, generated from the registry so the two can never disagree.
 *
 * Counts are shown before anything is downloaded, including the ones that are zero: a tab with no
 * rows is information, not an omission to be quietly smoothed over.
 */
export default async function DeliverablePage() {
  await requirePagePermission("registry.view");

  const [{ sheets, summary }, states, batches] = await Promise.all([
    buildDeliverable(),
    prisma.pharmacy.groupBy({ by: ["state"], _count: true, orderBy: { state: "asc" } }),
    prisma.importBatch.aggregate({ _sum: { duplicatesPrevented: true } }),
  ]);
  summary.totalDuplicatesRemoved = batches._sum.duplicatesPrevented ?? 0;

  const count = (name: string) => sheets.find((s) => s.name === name)?.rows.length ?? 0;

  return (
    <>
      <PageHeader title="Client deliverable"
        subtitle="The eight tabs the brief specifies, built from the registry. Excel in one file; one CSV per tab for Google Sheets."
        actions={
          /* A real navigation, not a client-side one: this downloads a file. */
          <a href="/api/deliverable" className="btn btn-primary" download>
            <Icon name="upload_file" size={16} /> Download the workbook
          </a>
        } />
      <StageBar stage="deliver" />

      {summary.totalValidEmails === 0 && (
        <Note tone="warn">
          <strong>The campaign tab is empty, and correctly so.</strong> No address has been through
          a verification service, so none can be called valid. Run a round at{" "}
          <Link href="/verification/email" className="link">Email Verification</Link> and this tab fills
          itself — the brief asks for valid addresses only, and inventing them is the one thing
          that would make the file worthless.
        </Note>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="Independent pharmacies" value={summary.totalIndependentPharmacies}
          icon={<Icon name="storefront" size={18} />} />
        <Stat label="Valid emails" value={summary.totalValidEmails}
          tone={summary.totalValidEmails ? "ok" : "warn"} hint="verified deliverable" />
        <Stat label="Chains and institutions removed" value={summary.totalChainsRemoved}
          tone="bad" />
        <Stat label="States covered" value={summary.statesCovered.length}
          hint={`of 51 requested · ${summary.statesCovered.join(", ")}`}
          tone={summary.statesCovered.length < 51 ? "warn" : "ok"} />
      </div>

      <Card pad={false} title="The tabs" subtitle="Row counts as they stand right now">
        <table className="tbl">
          <thead><tr><th>#</th><th>Tab</th><th>Rows</th><th>What it contains</th><th></th></tr></thead>
          <tbody>
            {[
              ["Every pharmacy that passed the inclusion and exclusion rules"],
              ["Only addresses a verifier returned as valid — the campaign list"],
              ["Everything with a phone number, verified email or not"],
              ["Catch-all, risky and unknown results, kept apart from the valid list"],
              ["Pharmacies with no usable address, for phone outreach"],
              ["Ownership could not be settled from the data — a human decides"],
              ["What was removed, and the rule that removed it"],
              ["Per-state totals across every category"],
            ].map(([what], i) => (
              <tr key={TABS[i]}>
                <td className="t-mono text-muted">{i + 1}</td>
                <td className="font-medium">{TABS[i]}</td>
                <td className="tabular-nums">{count(TABS[i]).toLocaleString()}</td>
                <td className="t-small text-muted">{what}</td>
                <td>
                  <a href={`/api/deliverable?format=csv&tab=${i}`} className="btn btn-sm">
                    CSV
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Card title="Sample first"
          subtitle="The brief asks for 50 verified pharmacies from at least 10 states before the full run">
          <div className="space-y-3">
            <p className="t-body">
              A sample is drawn across as many states as the registry holds, taking from each in
              turn rather than filling up from one.
            </p>
            <Note tone={summary.statesCovered.length >= 10 ? "ok" : "warn"}>
              The registry covers <strong>{summary.statesCovered.length} states</strong>
              {summary.statesCovered.length < 10
                ? " — a 50-record sample cannot reach ten until more jurisdictions are acquired."
                : " — enough to meet the brief's spread."}
            </Note>
            {/* A real navigation: this downloads a file. */}
            <a href="/api/deliverable?sample=50" className="btn btn-primary" download>
              <Icon name="upload_file" size={16} /> Download a 50-record sample
            </a>
          </div>
        </Card>

        <Card title="By state" subtitle="Pick one state's worth">
          <div className="flex flex-wrap gap-1.5">
            {states.filter((s) => s.state).map((s) => (
              <a key={s.state} href={`/api/deliverable?state=${s.state}`} className="btn btn-sm">
                {s.state}
                <span className="text-muted tabular-nums">{s._count.toLocaleString()}</span>
              </a>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Final report" subtitle="Included as its own tab in the workbook">
        <div className="grid md:grid-cols-2 gap-x-8">
          <div>
            <Row label="Total independent pharmacies" value={summary.totalIndependentPharmacies.toLocaleString()} />
            <Row label="Total valid emails" value={summary.totalValidEmails.toLocaleString()} />
            <Row label="Emails not yet verified" value={summary.emailsNotYetVerified.toLocaleString()} />
            <Row label="Pharmacies without an email" value={summary.totalWithoutEmail.toLocaleString()} />
          </div>
          <div>
            <Row label="Chains and institutions removed" value={summary.totalChainsRemoved.toLocaleString()} />
            <Row label="Closed businesses removed" value={summary.totalClosedRemoved.toLocaleString()} />
            <Row label="Duplicates prevented" value={summary.totalDuplicatesRemoved.toLocaleString()} />
            <Row label="Active licences" value={summary.totalActiveLicensesVerified.toLocaleString()} />
          </div>
        </div>

        <div className="mt-4 pt-3.5 hairline">
          <div className="t-small font-medium mb-2">What this file does not claim</div>
          <ul className="space-y-1.5">
            {summary.caveats.map((c) => (
              <li key={c} className="flex gap-2 t-small text-muted leading-relaxed">
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}
