import { requirePagePermission } from "@/lib/auth";
import { allMailboxHealth } from "@/lib/campaign/health";
import { config } from "@/lib/config";
import { Badge, Card, Empty, Note, PageHeader, Stat } from "@/components/ui";
import { HBars } from "@/components/charts";
import { setMailboxStatus } from "@/lib/mail/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sender health" };

export default async function SenderHealth() {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("campaign.view");
  const health = await allMailboxHealth();
  const totals = health.reduce((a, h) => ({
    sent: a.sent + h.sent, bounced: a.bounced + h.bounced,
    failed: a.failed + h.failed, replied: a.replied + h.replied,
    remaining: a.remaining + (h.mailbox.status === "CONNECTED" ? h.capacity.remaining : 0),
  }), { sent: 0, bounced: 0, failed: 0, replied: 0, remaining: 0 });
  const overallBounce = totals.sent ? (totals.bounced / totals.sent) * 100 : null;

  return (
    <>
      <PageHeader title="Sender health"
        subtitle="Outcomes the system actually observed for each sending mailbox. Bounces are counted from real bounce notifications; there is no open tracking and no delivery confirmation." />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="Accepted by provider" value={totals.sent} hint="not a delivery guarantee" />
        <Stat label="Bounced" value={totals.bounced} />
        <Stat label="Replied" value={totals.replied} />
        <Stat label="Send failures" value={totals.failed} hint="provider rejected the call" />
        <Stat label="Capacity left today" value={totals.remaining} />
      </div>

      {overallBounce !== null && (
        <Note tone={overallBounce >= config.autoPause.bounceRateThreshold ? "bad" : "neutral"}>
          Overall bounce rate <strong>{overallBounce.toFixed(1)}%</strong> across{" "}
          {totals.sent.toLocaleString()} accepted messages. The auto-pause threshold is{" "}
          {config.autoPause.bounceRateThreshold}% per mailbox, applied only once a mailbox has{" "}
          {config.autoPause.minSendsBeforeBounceCheck} sends — below that there is not enough
          evidence to judge, so no rate is shown at all.
        </Note>
      )}

      {health.length > 1 && (
        <Card title="Capacity remaining today" subtitle="Effective cap minus what each mailbox has already sent">
          <HBars data={health.map((h) => ({
            label: h.mailbox.emailAddress,
            value: h.mailbox.status === "CONNECTED" ? h.capacity.remaining : 0,
            tone: h.mailbox.status === "CONNECTED" ? ("accent" as const) : ("neutral" as const),
          }))} unit="left" empty="No mailboxes." />
        </Card>
      )}

      {health.length === 0 ? (
        <Card>
          <Empty action={<Link href="/settings/mailboxes" className="btn btn-primary">
            Connect a mailbox</Link>}>
            No mailboxes yet. A campaign needs at least one connected mailbox before it can send
            anything.
          </Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {health.map((h) => (
            <div key={h.mailbox.id} className="card p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[14px]">{h.mailbox.emailAddress}</span>
                    <Badge value={h.mailbox.status} />
                    <span className={`badge ${
                      h.shouldPause ? "tone-bad"
                        : h.warnings.length ? "tone-warn"
                        : "tone-ok"}`}>
                      {h.shouldPause ? "over threshold" : h.warnings.length ? "watch" : "ok"}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    ramp {h.mailbox.rampStage} · {h.capacity.remaining} of {h.capacity.limit} left today ·
                    window {h.mailbox.sendingStartTime}–{h.mailbox.sendingEndTime} {h.mailbox.timezone}
                  </div>
                </div>
                {h.mailbox.status === "PAUSED" && (
                  <form action={setMailboxStatus.bind(null, h.mailbox.id, "CONNECTED")}>
                    <button className="btn">Resume</button>
                  </form>
                )}
              </div>

              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-[12px]">
                <M label="Accepted" value={h.sent} />
                <M label="Bounced" value={h.bounced} />
                <M label="Replied" value={h.replied} />
                <M label="Failures" value={h.failed} />
                <M label="Bounce rate"
                  value={h.bounceRate === null ? "n/a" : `${h.bounceRate.toFixed(1)}%`}
                  hint={h.bounceRate === null ? "too few sends" : undefined} />
                <M label="Reply rate"
                  value={h.replyRate === null ? "n/a" : `${h.replyRate.toFixed(1)}%`} />
              </div>

              {h.shouldPause && (
                <div className="text-[12px] text-bad border-t border-line pt-2">
                  Safety brake: {h.shouldPause}. The worker pauses this mailbox automatically and it
                  stays paused until a human resumes it.
                </div>
              )}
              {!h.shouldPause && h.warnings.length > 0 && (
                <ul className="text-[11px] text-muted border-t border-line pt-2 space-y-0.5">
                  {h.warnings.map((w, i) => <li key={i}>· {w}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <Card title="What these numbers are not" className="text-[11px] text-muted">
        <div className="space-y-1">
        <div>· &ldquo;Accepted&rdquo; means the provider took the message. It is not delivery, and the
          application never records a DELIVERED state.</div>
        <div>· There is no open rate, click rate or read receipt — no tracking pixels are embedded,
          so those numbers do not exist and are not estimated.</div>
        <div>· Reply rate counts inbound messages matched to a sent message by thread or message-id.</div>
        </div>
      </Card>
    </>
  );
}

function M({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}
