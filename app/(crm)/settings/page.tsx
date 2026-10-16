import { requirePagePermission } from "@/lib/auth";
import { Card, Note, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { config, liveSendingAllowed } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { saveCompanySettings, pauseAllCampaignsForm } from "@/lib/settings-actions";
import { ELIGIBILITY_RULES } from "@/lib/campaign/eligibility";
import { readiness, type ReadinessState } from "@/lib/readiness";
import { checkConfig } from "@/lib/config";
import { Icon, type IconName } from "@/components/icon";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Settings() {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("settings.manage");
  const s = await getSettings();
  const live = liveSendingAllowed();
  const ready = await readiness();
  const problems = checkConfig();
  const [mailboxes, running, suppressed] = await Promise.all([
    prisma.mailbox.count({ where: { status: "CONNECTED" } }),
    prisma.campaign.count({ where: { status: "RUNNING" } }),
    prisma.suppressionEntry.count(),
  ]);

  return (
    <>
      <PageHeader title="Settings"
        subtitle="Company identity is editable here. Anything that controls whether email can leave the application is environment-only and read-only in the UI by design." />

      <Card className="crm-demo-guide" title="Readiness"
        subtitle={ready.canSendToRealPharmacies
          ? "Everything that has to be true before real outreach is true"
          : "What still stands between this deployment and contacting a real pharmacy"}>
        <ul className="space-y-2.5">
          {ready.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5">
              <span className={`mt-0.5 ${READY_TONE[item.state].text}`}>
                <Icon name={READY_TONE[item.state].icon} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="t-body font-medium">{item.title}</span>
                  <span className={`badge ${READY_TONE[item.state].badge}`}>
                    {READY_TONE[item.state].label}
                  </span>
                  {item.href && (
                    <Link href={item.href} className="t-small link">open →</Link>
                  )}
                </span>
                <span className="block t-small text-muted mt-0.5 leading-relaxed">
                  {item.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p data-ui="description" className="t-small text-muted mt-3 pt-3 hairline leading-relaxed">
          Credentials are only part of it. A deployment with perfect environment variables and no
          verified records still cannot send to anybody, so those steps are listed here rather than
          treated as someone else&apos;s problem.
        </p>
      </Card>

      {problems.length > 0 && (
        <Card className="crm-demo-guide" title="Configuration notes"
          subtitle="Read from the environment at startup; the health endpoint reports the same list">
          <ul className="space-y-1.5">
            {problems.map((p) => (
              <li key={p.key} className="flex items-start gap-2 t-small">
                <span className={`badge ${p.fatal ? "tone-bad" : "tone-warn"} shrink-0`}>
                  {p.fatal ? "blocking" : "warning"}
                </span>
                <span><code className="text-ink">{p.key}</code>{" "}
                  <span className="text-muted">{p.message}</span></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {live.allowed && (
        <Note tone="bad">
          <strong>Live sending is on.</strong> Both switches are set, so a running campaign will
          deliver real email to whatever is on the test allowlist. Turn it off in the environment
          when you are done testing.
        </Note>
      )}

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card title="Company information"
          subtitle="Appears in the footer of every outgoing message — a physical postal address is a legal requirement for commercial email in the US">
          <form action={saveCompanySettings} className="space-y-2.5">
            <L label="Company name"><input name="name" defaultValue={s["company.name"]} className="inp w-full" /></L>
            <L label="Postal address"><input name="address" defaultValue={s["company.address"]} className="inp w-full" /></L>
            <L label="Website"><input name="website" defaultValue={s["company.website"]} className="inp w-full" /></L>
            <L label="Reply-to (optional)"><input name="replyTo" defaultValue={s["company.replyTo"]} className="inp w-full" /></L>
            <button className="btn btn-primary">Save</button>
          </form>
          {!s["company.address"] && (
            <div className="text-[11px] text-warn mt-2.5">
              No postal address set — outgoing mail will be missing a required footer element.
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Sending mode" subtitle="Read from the environment; not editable here">
            <Row k="EMAIL_MODE" v={config.emailMode} />
            <Row k="ENABLE_LIVE_EMAIL_SENDING" v={String(config.liveSendingEnabled)} />
            <Row k="Real email can leave the app" v={live.allowed ? "YES" : `no — ${live.reason}`}
              tone={live.allowed ? "warn" : "ok"} />
            <Row k="Live test allowlist"
              v={config.liveTestAllowlist.length
                ? config.liveTestAllowlist.join(", ")
                : "empty — in live mode every address is refused"} />
            <p data-ui="description" className="text-[11px] text-muted pt-2 mt-2 hairline leading-relaxed">
              Both switches must be on before a single real message is sent. Keeping them in the
              environment rather than the database is deliberate: enabling live sending should take
              a deployment, not a click.
            </p>
          </Card>

          <Card title="Sending limits" subtitle="Responsible-sending caps — not filter evasion">
            <Row k="Default mailbox daily limit" v={String(config.limits.defaultMailboxDaily)} />
            <Row k="Global daily limit" v={String(config.limits.globalDaily)} />
            <Row k="Ramp caps" v={`NEW ${config.rampLimits.NEW} · RAMPING ${config.rampLimits.RAMPING} · ESTABLISHED ${config.rampLimits.ESTABLISHED}`} />
            <Row k="Default window"
              v={`${config.schedule.start}–${config.schedule.end} ${config.schedule.timezone}`} />
            <Row k="Auto-pause bounce rate" v={`${config.autoPause.bounceRateThreshold}% after ${config.autoPause.minSendsBeforeBounceCheck} sends`} />
            <Row k="Auto-pause failure streak" v={`${config.autoPause.consecutiveFailuresThreshold} consecutive failures`} />
            <p data-ui="description" className="text-[11px] text-muted pt-2 mt-2 hairline">
              Per-mailbox limits are set on{" "}
              <Link href="/settings/mailboxes" className="link">Mailboxes</Link>.
            </p>
          </Card>
        </div>
      </div>

      <Card title="Safety controls" className="border-bad/25"
        subtitle="The switches you reach for when something is going wrong">
        <div className="grid md:grid-cols-3 gap-4 text-[12px]">
          <div>
            <div className="text-muted text-[11px]">Running campaigns</div>
            <div className="text-[20px] font-semibold tabular-nums">{running}</div>
            <form action={pauseAllCampaignsForm} className="mt-1.5">
              <button className="btn btn-danger" disabled={running === 0}>
                Pause everything
              </button>
            </form>
            <p className="text-[11px] text-muted mt-1">
              Stops every running campaign immediately. In-flight messages already handed to the
              provider cannot be recalled.
            </p>
          </div>
          <div>
            <div className="text-muted text-[11px]">Connected mailboxes</div>
            <div className="text-[20px] font-semibold tabular-nums">{mailboxes}</div>
            <Link href="/settings/mailboxes" className="btn mt-1.5 inline-block">Manage</Link>
          </div>
          <div>
            <div className="text-muted text-[11px]">Suppressed addresses</div>
            <div className="text-[20px] font-semibold tabular-nums">{suppressed.toLocaleString()}</div>
            <Link href="/settings/suppression" className="btn mt-1.5 inline-block">Suppression list</Link>
          </div>
        </div>
      </Card>

      <Card className="crm-demo-guide" title="Recipient eligibility rules"
        subtitle="Enforced server-side at selection, at campaign build, at queueing and again immediately before each send — and not configurable from the UI">
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-[12px]">
          {ELIGIBILITY_RULES.map((r) => (
            <li key={r} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              <code className="text-muted">{r}</code>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const READY_TONE: Record<ReadinessState,
  { icon: IconName; text: string; badge: string; label: string }> = {
  done:     { icon: "check_circle", text: "text-ok", badge: "tone-ok", label: "done" },
  todo:     { icon: "info", text: "text-warn", badge: "tone-warn", label: "to do" },
  blocked:  { icon: "block", text: "text-bad", badge: "tone-bad", label: "blocking" },
  optional: { icon: "shield", text: "text-muted", badge: "tone-neutral", label: "optional" },
};

function Row({ k, v, tone }: { k: string; v: string; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-muted">{k}</span>
      <span className={`text-right ${tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : ""}`}>
        {v}
      </span>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-muted mb-0.5">{label}</span>
      {children}
    </label>
  );
}
