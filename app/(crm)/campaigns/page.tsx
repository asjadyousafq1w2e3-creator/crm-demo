import Link from "next/link";
import { requirePagePermission, sessionCan } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, Empty, Note, PageHeader, Stat, Badge } from "@/components/ui";
import { Icon } from "@/components/icon";
import { StageBar } from "@/components/pipeline";
import { config } from "@/lib/config";
import { HUMAN_REPLY } from "@/lib/inbox/classify";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

/** Statuses grouped the way an operator thinks about them, not the way they are stored. */
const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "active", label: "Active", statuses: ["RUNNING", "SCHEDULED", "PAUSED"] },
  { key: "draft", label: "Drafts", statuses: ["DRAFT", "READY"] },
  { key: "finished", label: "Finished", statuses: ["COMPLETED", "CANCELLED"] },
  { key: "all", label: "All", statuses: [] },
];

export default async function Campaigns({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("campaign.view");
  const mayEdit = await sessionCan("campaign.edit");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];

  const where = {
    ...(tab.statuses.length ? { status: { in: tab.statuses } } : {}),
    ...(sp.q?.trim() ? { name: { contains: sp.q.trim(), mode: "insensitive" as const } } : {}),
  };

  const [campaigns, tabCounts, totals] = await Promise.all([
    prisma.campaign.findMany({
      where, orderBy: [{ status: "asc" }, { id: "desc" }],
      include: {
        _count: { select: { recipients: true, steps: true } },
        steps: { where: { active: true }, select: { stepNumber: true, waitDays: true },
                 orderBy: { stepNumber: "asc" } },
      },
    }),
    Promise.all(TABS.map((t) => prisma.campaign.count({
      where: t.statuses.length ? { status: { in: t.statuses } } : {} }))),
    (async () => {
      const [byStatus, replies, running] = await Promise.all([
        prisma.campaignRecipient.groupBy({ by: ["status"], _count: true }),
        prisma.conversation.count({ where: { category: { in: [...HUMAN_REPLY] } } }),
        prisma.campaign.count({ where: { status: "RUNNING" } }),
      ]);
      const n = (s: string) => byStatus.find((r) => r.status === s)?._count ?? 0;
      return { sent: n("SENT") + n("REPLIED") + n("BOUNCED"), queued: n("QUEUED") + n("SCHEDULED"),
               bounced: n("BOUNCED"), replies, running };
    })(),
  ]);

  // Per-campaign recipient counts in one query rather than one per row.
  const recipientRows = await prisma.campaignRecipient.groupBy({
    by: ["campaignId", "status"], _count: true,
    where: { campaignId: { in: campaigns.map((c) => c.id) } },
  });
  const statsFor = (id: number) => {
    const rows = recipientRows.filter((r) => r.campaignId === id);
    const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
    const sent = n("SENT") + n("REPLIED") + n("BOUNCED");
    return {
      total: rows.reduce((a, r) => a + r._count, 0),
      sent, replied: n("REPLIED"), bounced: n("BOUNCED"),
      pending: n("PENDING") + n("QUEUED") + n("SCHEDULED"),
      blocked: n("BLOCKED"),
      replyRate: sent ? (n("REPLIED") / sent) * 100 : null,
      bounceRate: sent ? (n("BOUNCED") / sent) * 100 : null,
    };
  };

  const sentTotal = totals.sent;

  return (
    <>
      <PageHeader title="Campaigns"
        subtitle="A campaign is a sequence, not a single mail-out. Only a verified, eligible recipient is ever written to, and a reply stops everything queued for that pharmacy."
        actions={mayEdit
          ? <Link href="/campaigns/new" className="btn btn-primary btn-sm">
              <Icon name="campaign" size={16} /> New campaign
            </Link>
          : undefined} />
      <StageBar stage="campaign" />

      {config.emailMode !== "gmail" && (
        <Note tone="warn">
          <span className="badge tone-warn mr-2">DEMO EMAIL MODE</span>
          Messages are simulated end to end — the queue, the scheduler, the sequence timer and the
          router all run, but nothing leaves the application.
        </Note>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
        <Stat label="Running now" value={totals.running}
          tone={totals.running ? "ok" : undefined} icon={<Icon name="send" size={18} />} />
        <Stat label="Messages sent" value={sentTotal} hint="attempts the provider accepted" />
        <Stat label="Waiting to send" value={totals.queued} hint="queued or scheduled" />
        <Stat label="Replies from a person" value={totals.replies} tone="ok"
          hint="autoresponders excluded" />
        <Stat label="Bounced" value={totals.bounced}
          tone={totals.bounced ? "bad" : undefined}
          hint={sentTotal ? `${((totals.bounced / sentTotal) * 100).toFixed(1)}% of sent` : "none yet"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t, i) => (
            <Link key={t.key} href={t.key === "active" ? "/campaigns" : `/campaigns?tab=${t.key}`}
              data-active={tab.key === t.key}
              className="badge tone-neutral flex items-center gap-1.5 hover:bg-high
                         data-[active=true]:bg-accent data-[active=true]:text-accent-ink
                         transition-colors">
              {t.label}<span className="tabular-nums opacity-70">{tabCounts[i]}</span>
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-1.5">
          {tab.key !== "active" && <input type="hidden" name="tab" value={tab.key} />}
          <input name="q" defaultValue={sp.q ?? ""} className="input !w-56"
                 placeholder="Search campaigns" />
          <button className="btn btn-sm">Search</button>
        </form>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <Empty action={mayEdit
            ? <Link href="/campaigns/new" className="btn btn-primary">
                <Icon name="campaign" size={16} /> Create the first campaign
              </Link>
            : undefined}>
            {sp.q ? "No campaign matches that search."
                  : "No campaigns here. A campaign holds the message, the sequence, the schedule and the recipient list — building one changes nothing until you explicitly start it."}
          </Empty>
        </Card>
      ) : (
        <Card pad={false}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Campaign</th>
                <th className="text-center">Sequence</th>
                <th className="text-right">Recipients</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Replies</th>
                <th className="text-right">Bounces</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const s = statsFor(c.id);
                const steps = c.steps.length || 1;
                const pct = s.total ? Math.round((s.sent / s.total) * 100) : 0;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/campaigns/${c.id}`}
                        className="font-semibold hover:text-accent">{c.name}</Link>
                      <div className="t-small text-muted truncate max-w-[26rem]">{c.subject}</div>
                    </td>
                    <td className="text-center">
                      <span className="badge tone-neutral" title={c.steps.length
                        ? `Day ${c.steps.reduce((a, x, i) => i ? a + x.waitDays : 0, 0)} by the last step`
                        : "A single message"}>
                        {steps} {steps === 1 ? "step" : "steps"}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">
                      {s.total.toLocaleString()}
                      {s.blocked > 0 && (
                        <div className="t-small text-warn">{s.blocked} blocked</div>)}
                    </td>
                    <td className="text-right tabular-nums">{s.sent.toLocaleString()}</td>
                    <td className="text-right tabular-nums">
                      {s.replied.toLocaleString()}
                      {s.replyRate !== null && s.sent >= 20 && (
                        <div className="t-small text-muted">{s.replyRate.toFixed(1)}%</div>)}
                    </td>
                    <td className="text-right tabular-nums">
                      <span className={s.bounceRate !== null && s.bounceRate > 5 ? "text-bad" : ""}>
                        {s.bounced.toLocaleString()}
                      </span>
                      {s.bounceRate !== null && s.sent >= 20 && (
                        <div className={`t-small ${s.bounceRate > 5 ? "text-bad" : "text-muted"}`}>
                          {s.bounceRate.toFixed(1)}%
                        </div>)}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Badge value={c.status} />
                        <span className="flex-1 min-w-[3rem] h-1.5 rounded-full bg-sunken
                          overflow-hidden">
                          <span className="block h-full bg-accent rounded-full"
                            style={{ width: `${pct}%` }} />
                        </span>
                        <span className="t-small text-muted tabular-nums w-9 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <p className="t-small text-muted">
        Reply and bounce rates are shown once a campaign has at least 20 sends — below that a
        percentage is noise dressed as a measurement. There is no open rate: nothing here embeds
        a tracking pixel, so an open is not something this system can honestly claim to know.
      </p>
    </>
  );
}
