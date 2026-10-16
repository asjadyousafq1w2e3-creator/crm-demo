import { prisma } from "@/lib/db";
import type { Mailbox, Prisma } from "@prisma/client";
import { getSession, requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { totalCapacityToday } from "@/lib/campaign/router";
import { Badge, Card, Empty, Note, PageHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Columns, Donut, Funnel, HBars, Meter, Sparkline, type Slice } from "@/components/charts";
import Link from "next/link";
import { PipelineBoard } from "@/components/pipeline";
import { footerCompliance, footerProblem } from "@/lib/settings";
import { isCrmShowcase } from "@/lib/showcase-mode";
import { DashboardOverview } from "@/components/dashboard/overview";

export const dynamic = "force-dynamic";

/** Rules mirrored from lib/campaign/eligibility.ts, as a query, so the headline count is real. */
const ELIGIBLE_WHERE: Prisma.PharmacyWhereInput = {
  email: { not: null },
  verificationStatus: "VERIFIED",
  licenseStatus: "ACTIVE",
  operationalStatus: "OPEN",
  ownershipStatus: { in: ["INDEPENDENT", "LOCAL_GROUP"] },
  emailVerificationStatus: "VALID",
};

const DAYS = isCrmShowcase() ? 30 : 14;

export default async function Dashboard() {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("registry.view");
  const session = await getSession();
  const showOutreach = can(session?.role, "campaign.view");
  // Shown regardless of how far down the pipeline anybody is: it blocks every campaign, and it
  // takes half a minute to fix, so burying it until step seven would be the wrong trade.
  const footerBlocker = showOutreach ? footerProblem(await footerCompliance()) : null;

  const [
    total, withEmail, withPhone, withWebsite, withOwner, withNpi,
    states, byVerification, byLead, tasksByStatus, batch, byState, eligibleNow,
  ] = await Promise.all([
    prisma.pharmacy.count(),
    prisma.pharmacy.count({ where: { email: { not: null } } }),
    prisma.pharmacy.count({ where: { phone: { not: null } } }),
    prisma.pharmacy.count({ where: { website: { not: null } } }),
    prisma.pharmacy.count({ where: { OR: [{ ownerName: { not: null } }, { picName: { not: null } }] } }),
    prisma.pharmacy.count({ where: { npi: { not: null } } }),
    prisma.pharmacy.findMany({ distinct: ["state"], select: { state: true } }),
    prisma.pharmacy.groupBy({ by: ["verificationStatus"], _count: true }),
    prisma.pharmacy.groupBy({ by: ["leadStatus"], _count: true }),
    prisma.verificationTask.groupBy({ by: ["status"], _count: true }),
    prisma.importBatch.findFirst({ where: { status: "OK" }, orderBy: { id: "desc" } }),
    prisma.pharmacy.groupBy({ by: ["state"], _count: true, orderBy: { _count: { state: "desc" } } }),
    prisma.pharmacy.count({ where: ELIGIBLE_WHERE }),
  ]);

  const v = (s: string) => byVerification.find((r) => r.verificationStatus === s)?._count ?? 0;
  const task = (s: string) => tasksByStatus.find((r) => r.status === s)?._count ?? 0;
  const tasksTotal = tasksByStatus.reduce((a, r) => a + r._count, 0);

  // --- outreach, only queried for roles that may see it ---------------------------------------
  const outreach = showOutreach ? await Promise.all([
    prisma.campaignRecipient.groupBy({ by: ["status"], _count: true }),
    prisma.campaign.count({ where: { status: "RUNNING" } }),
    prisma.mailbox.findMany(),
    prisma.conversation.count({ where: { unread: true } }),
    prisma.followUp.count({ where: { status: { in: ["PENDING", "DUE"] } } }),
    prisma.suppressionEntry.count(),
  ]) : null;
  const recipientStats: { status: string; _count: number }[] = outreach?.[0] ?? [];
  const campaignsRunning = outreach?.[1] ?? 0;
  const mailboxes: Mailbox[] = outreach?.[2] ?? [];
  const unread = outreach?.[3] ?? 0;
  const followUpsDue = outreach?.[4] ?? 0;
  const suppressed = outreach?.[5] ?? 0;

  const r = (s: string) => recipientStats.find((x) => x.status === s)?._count ?? 0;
  const accepted = r("SENT") + r("REPLIED") + r("BOUNCED");
  const capacity = totalCapacityToday(mailboxes);
  const connected = mailboxes.filter((m) => m.status === "CONNECTED").length;

  // --- activity: real audit rows per day, nothing interpolated ---------------------------------
  const since = new Date(Date.now() - (DAYS - 1) * 864e5);
  since.setUTCHours(0, 0, 0, 0);
  const activityRows = await prisma.$queryRaw<{ day: string; n: bigint }[]>`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS day, count(*) AS n
    FROM audit_event WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`;
  const byDay = new Map(activityRows.map((x) => [x.day, Number(x.n)]));
  const activity = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(since.getTime() + i * 864e5).toISOString().slice(0, 10);
    return { day: d, n: byDay.get(d) ?? 0 };
  });
  const recent = await prisma.auditEvent.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8 });

  if (isCrmShowcase()) {
    const pharmacies = await prisma.pharmacy.findMany({
      orderBy: { id: "asc" }, take: 5,
      select: { id: true, canonicalName: true, city: true, state: true, email: true, phone: true, verificationStatus: true },
    });
    return <DashboardOverview
      name={session?.name || "there"} total={total} withEmail={withEmail} withPhone={withPhone}
      withWebsite={withWebsite} withOwner={withOwner} verified={v("VERIFIED")}
      ready={v("READY_FOR_VERIFICATION")} inVerification={v("IN_VERIFICATION")}
      needsReview={v("NEEDS_REVIEW")} excluded={v("EXCLUDED")} eligible={eligibleNow}
      stateCount={states.filter(state => state.state).length}
      tasks={task("NOT_STARTED") + task("IN_PROGRESS") + task("BLOCKED")}
      campaigns={campaignsRunning} accepted={accepted} replies={r("REPLIED")}
      unread={unread} followUps={followUpsDue} capacity={capacity} connected={connected}
      showOutreach={showOutreach} canCreateCampaign={can(session?.role, "campaign.edit")}
      byState={byState.filter(state => state.state).map(state => ({ state: state.state!, count: state._count })).sort((a, b) => b.count - a.count || a.state.localeCompare(b.state))}
      activity={activity} recent={recent} pharmacies={pharmacies} batch={batch}
    />;
  }

  return (
    <>
      <PageHeader
        title={`Good to see you${session?.name ? `, ${session.name.split(" ")[0]}` : ""}`}
        subtitle={isCrmShowcase() ? "Explore your original CRM with fictional sample data. This is a display-only demo — no database, live sending, or saved changes." : "Live figures from the master registry. Every number on this page is a query — nothing is cached, estimated or carried forward from a report."}
        actions={
          <>
            <Link href="/pharmacies" className="btn btn-sm">
              <Icon name="storefront" size={16} /> Browse registry
            </Link>
            {can(session?.role, "campaign.edit") && (
              <Link href="/campaigns/new" className="btn btn-primary btn-sm">
                <Icon name="campaign" size={16} /> New campaign
              </Link>
            )}
          </>
        }
      />

      {!isCrmShowcase() && <PipelineBoard />}

      {!isCrmShowcase() && footerBlocker && (
        <Note tone="bad">
          <strong>No campaign can start yet.</strong> {footerBlocker}{" "}
          <Link href="/settings" className="link">Open settings</Link>.
        </Note>
      )}

      {!isCrmShowcase() && v("VERIFIED") === 0 && (
        <Note tone="warn">
          <strong>Outreach is blocked, and that is correct.</strong> No pharmacy has been
          business-verified yet, so campaign eligibility returns zero. The system will not invent
          a verified status to make sending possible. Next step: verify the{" "}
          {withEmail.toLocaleString()} email addresses, then work the verification queue.
        </Note>
      )}

      {/* ---------------------------------------------------------------- headline */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <Stat label="Master pharmacies" value={total} href="/pharmacies"
          icon={<Icon name="storefront" size={18} />}
          hint={`${states.filter((s) => s.state).length} states`} />
        <Stat label="With email" value={withEmail} icon={<Icon name="mail" size={18} />}
          hint={`${((withEmail / total) * 100).toFixed(0)}% of records`} />
        <Stat label="With phone" value={withPhone}
          hint={`${((withPhone / total) * 100).toFixed(0)}% of records`} />
        <Stat label="Verified" value={v("VERIFIED")} icon={<Icon name="verified" size={18} />}
          tone={v("VERIFIED") ? "ok" : undefined}
          href="/verification" hint="business-verified records" />
        <Stat label="Campaign-eligible" value={eligibleNow} icon={<Icon name="send" size={18} />}
          tone={eligibleNow ? "ok" : "warn"} hint="passes all six rules right now" />
        <Stat label="Open verification tasks" value={task("NOT_STARTED")} href="/verification"
          hint={`of ${tasksTotal.toLocaleString()} total`} />
      </div>

      {/* ---------------------------------------------------------------- registry */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Verification pipeline" subtitle="Where every master record stands">
          <Donut
            data={([
              { label: "Ready for verification", value: v("READY_FOR_VERIFICATION"), tone: "accent" },
              { label: "In verification", value: v("IN_VERIFICATION"), tone: "info" },
              { label: "Verified", value: v("VERIFIED"), tone: "ok" },
              { label: "Needs review", value: v("NEEDS_REVIEW"), tone: "accent" },
              { label: "Excluded", value: v("EXCLUDED"), tone: "bad" },
            ] as Slice[]).filter((s) => s.value > 0)}
            centerValue={total} centerLabel="records"
          />
        </Card>

        <Card title="Contact data completeness"
          subtitle="Coverage per field, counted from the column itself">
          <div className="space-y-3">
            <Meter label="Email address" value={withEmail} total={total} tone="accent" />
            <Meter label="Phone number" value={withPhone} total={total} tone="info" />
            <Meter label="Owner or pharmacist-in-charge" value={withOwner} total={total} tone="ok" />
            <Meter label="NPI" value={withNpi} total={total} tone="neutral" />
            <Meter label="Website" value={withWebsite} total={total} tone="warn"
              caption={!isCrmShowcase() && withWebsite === 0
                ? "No government source publishes it — only discovery or a commercial file will fill this."
                : undefined} />
          </div>
        </Card>

        <Card title="Verification queue" subtitle={`${tasksTotal.toLocaleString()} tasks`}
          actions={<Link href="/verification" className="btn btn-sm">Open</Link>}>
          <HBars data={([
            { label: "Not started", value: task("NOT_STARTED"), tone: "info" },
            { label: "In progress", value: task("IN_PROGRESS"), tone: "info" },
            { label: "Completed", value: task("COMPLETED"), tone: "ok" },
            { label: "Blocked", value: task("BLOCKED"), tone: "bad" },
          ] as Slice[]).filter((d) => d.value > 0)} empty="No verification tasks yet." />
          <p data-ui="description" className="text-[11px] text-muted mt-3 pt-3 hairline leading-relaxed">
            A task is a dimension of one record that a human must confirm — licence, ownership,
            operational status, pharmacy type or contact details.
          </p>
        </Card>
      </div>

      <Card title="Records by state"
        subtitle="Four state boards publish usable pharmacy data; the rest are unconfirmed or paid"
        actions={<Link href="/pharmacies" className="btn btn-sm">Browse</Link>}>
        <Columns data={byState.filter((s) => s.state).map((s) => ({
          label: s.state!, value: s._count,
        }))} unit="pharmacies" empty="No records loaded." />
      </Card>

      {/* ---------------------------------------------------------------- outreach */}
      {showOutreach && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="section-label"><Icon name="send" size={16} /> Outreach</h2>
            <Link href="/campaigns" className="text-[12px] link">All campaigns →</Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
            <Stat label="Running campaigns" value={campaignsRunning} href="/campaigns" />
            <Stat label="Accepted by provider" value={accepted}
              hint="acceptance, not delivery" />
            <Stat label="Replies" value={r("REPLIED")} tone={r("REPLIED") ? "ok" : undefined}
              hint={accepted ? `${((r("REPLIED") / accepted) * 100).toFixed(1)}% of accepted` : "—"} />
            <Stat label="Bounced" value={r("BOUNCED")} tone={r("BOUNCED") ? "bad" : undefined}
              hint={accepted ? `${((r("BOUNCED") / accepted) * 100).toFixed(1)}% of accepted` : "—"} />
            <Stat label="Capacity today" value={capacity} href="/settings/mailboxes"
              hint={`${connected} connected mailbox${connected === 1 ? "" : "es"}`} />
            <Stat label="Suppressed" value={suppressed} href="/settings/suppression"
              hint="permanently unmailable" />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Card title="Send funnel" subtitle="Recipient rows, by the state they reached">
              <Funnel steps={[
                { label: "Recipients built", value: Object.values(recipientStats).reduce((a, x) => a + x._count, 0), tone: "neutral" },
                { label: "Queued to send", value: r("QUEUED") + r("SCHEDULED") + r("SENDING"), tone: "info" },
                { label: "Accepted by provider", value: accepted, tone: "accent" },
                { label: "Replied", value: r("REPLIED"), tone: "ok" },
              ] as Slice[]} empty="No campaign has built a recipient list yet." />
            </Card>

            <Card title="Lead pipeline" subtitle="Operator classification, not inference">
              <HBars
                data={byLead
                  .filter((l) => l.leadStatus !== "NOT_CONTACTED" && l._count > 0)
                  .map((l) => ({ label: l.leadStatus.replace(/_/g, " ").toLowerCase(), value: l._count }))}
                empty={isCrmShowcase() ? "No leads yet." : `Nothing contacted yet — all ${total.toLocaleString()} records are "not contacted".`} />
            </Card>

            <Card title="Needs your attention">
              <div className="space-y-2.5">
                <AttentionRow href="/inbox" label="Unread conversations" value={unread}
                  tone={unread ? "warn" : "neutral"} />
                <AttentionRow href="/follow-ups" label="Open follow-ups" value={followUpsDue}
                  tone={followUpsDue ? "warn" : "neutral"} />
                <AttentionRow href="/settings/mailboxes" label="Connected mailboxes"
                  value={connected} tone={connected ? "ok" : "bad"} />
                <AttentionRow href="/sender-health" label="Paused mailboxes"
                  value={mailboxes.filter((m) => m.status === "PAUSED").length}
                  tone={mailboxes.some((m) => m.status === "PAUSED") ? "bad" : "neutral"} />
              </div>
            </Card>
          </div>
        </>
      )}

      {/* ---------------------------------------------------------------- activity */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="Activity"
          subtitle={`Audit events per day over the last ${DAYS} days`}>
          <Sparkline points={activity.map((a) => a.n)} height={56}
            labels={activity.map((a) => a.day.slice(5))} />
          <ul className="mt-3 pt-3 hairline space-y-1.5">
            {recent.length === 0 ? <Empty>No activity recorded yet.</Empty> : recent.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-muted tabular-nums shrink-0 w-[105px]">
                  {e.createdAt.toISOString().slice(5, 16).replace("T", " ")}
                </span>
                <span className="font-medium shrink-0">
                  {e.eventType.replace(/_/g, " ").toLowerCase()}
                </span>
                <span className="text-muted truncate">{e.detail ?? ""}</span>
                <span className="text-muted ml-auto shrink-0 text-[11px]">{e.actor}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Latest import" subtitle={batch?.label ?? "no batches yet"}
          actions={<Link href="/data/batches" className="btn btn-sm">History</Link>}>
          {batch ? (
            <div className="space-y-1">
              {[["Received", batch.recordsReceived], ["New masters", batch.recordsAccepted],
                ["Changed", batch.recordsUpdated], ["Unchanged", batch.recordsUnchanged],
                ["Rejected", batch.recordsRejected],
                ["Duplicates prevented", batch.duplicatesPrevented]].map(([k, n]) => (
                <div key={String(k)}
                  className="flex justify-between text-[12px] py-1 border-b border-line/50 last:border-0">
                  <span className="text-muted">{k}</span>
                  <span className="tabular-nums">{Number(n).toLocaleString()}</span>
                </div>
              ))}
              <div className="pt-2">
                <Badge value={batch.status} />
              </div>
            </div>
          ) : <Empty>No import batches recorded.</Empty>}
        </Card>
      </div>
    </>
  );
}

function AttentionRow({ href, label, value, tone }: {
  href: string; label: string; value: number; tone: "ok" | "warn" | "bad" | "neutral";
}) {
  const dot = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", neutral: "bg-neutral" }[tone];
  return (
    <Link href={href}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 -mx-2 hover:bg-accent/[0.06]
                 transition-colors">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="text-[12px] text-muted flex-1">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums">{value.toLocaleString()}</span>
    </Link>
  );
}
