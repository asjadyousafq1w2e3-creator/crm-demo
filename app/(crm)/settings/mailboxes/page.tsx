import { requirePagePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { Icon } from "@/components/icon";
import { Badge, Card, Empty, Note, PageHeader } from "@/components/ui";
import { effectiveDailyLimit, remainingToday } from "@/lib/campaign/router";
import { windowStatus, localDate } from "@/lib/campaign/schedule";
import {
  setMailboxStatus, disconnectMailbox, updateMailboxLimits, addMockMailbox, syncNowForm,
} from "@/lib/mail/actions";
import { StageBar } from "@/components/pipeline";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  oauth_not_configured: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
  state_mismatch: "OAuth state did not match. The request was discarded.",
  no_code: "Google did not return an authorization code.",
  no_refresh_token: "Google returned no refresh token. Revoke the app at myaccount.google.com/permissions and connect again.",
  no_email: "Could not read the account's email address.",
  missing_scopes: "Some required scopes were not granted. Connect again and approve all of them.",
};

export default async function Mailboxes({ searchParams }: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("mailbox.manage");
  const sp = await searchParams;
  const mailboxes = await prisma.mailbox.findMany({ orderBy: { id: "asc" } });
  const now = new Date();
  const oauthReady = Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);

  // 7-day counters, read from real message rows - not estimated.
  const since = new Date(now.getTime() - 7 * 864e5);
  const sent7 = await prisma.emailMessage.groupBy({
    by: ["mailboxId"], where: { direction: "OUTBOUND", createdAt: { gte: since } }, _count: true });
  const bounced7 = await prisma.campaignRecipient.groupBy({
    by: ["mailboxId"], where: { status: "BOUNCED", updatedAt: { gte: since } }, _count: true });

  return (
    <>
      <PageHeader title="Mailboxes"
        subtitle="Sending accounts, their limits and their sending windows. Connect more than one and the router spreads volume across them, always skipping any mailbox that is paused, outside its window or at its cap."
        actions={oauthReady ? (
          // A real navigation, not a client-side one: the route handler answers with a redirect
          // to Google, which next/link cannot follow.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/api/oauth/google/start" className="btn btn-primary">
            <Icon name="alternate_email" size={16} /> Connect Gmail</a>
        ) : (
          <span className="btn opacity-50 cursor-not-allowed"
            title="GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are not all set">
            Connect Gmail
          </span>
        )} />
      <StageBar stage="mailbox" />

      {sp.connected && (
        <Note tone="ok">
          Connected <strong>{sp.connected}</strong>. Only the refresh token was stored, encrypted
          at rest — the access token is fetched per call and never persisted.
        </Note>
      )}
      {sp.error && <Note tone="bad">{ERRORS[sp.error] ?? sp.error}</Note>}

      {config.emailMode !== "gmail" && (
        <Note tone="warn">
          <span className="badge tone-warn mr-2">Demo email mode</span>
          <code>EMAIL_MODE={config.emailMode}</code>. Every mailbox below — including a connected
          Gmail account — routes through the mock provider, so no message can reach the internet.
        </Note>
      )}

      {mailboxes.length === 0 ? (
        <Card><Empty>
          No mailboxes connected. A campaign cannot send anything until at least one is available —
          in demo mode you can add a mock mailbox below without a Google account.
        </Empty></Card>
      ) : (
        <div className="space-y-3">
          {mailboxes.map((m) => {
            const cap = effectiveDailyLimit(m);
            const remaining = remainingToday(m, now);
            const w = windowStatus({
              timezone: m.timezone, sendingDays: "1,2,3,4,5,6,7",
              sendingStartTime: m.sendingStartTime, sendingEndTime: m.sendingEndTime }, now);
            const s7 = sent7.find((x) => x.mailboxId === m.id)?._count ?? 0;
            const b7 = bounced7.find((x) => x.mailboxId === m.id)?._count ?? 0;
            return (
              <div key={m.id} className="card p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[14px]">{m.emailAddress}</span>
                      <Badge value={m.status} />
                      <span className="badge tone-neutral">{m.provider}</span>
                      {m.encryptedRefreshToken && (
                        <span className="badge tone-neutral" title="Encrypted at rest">
                          token stored
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mt-1">
                      {m.displayName || "no display name"} · domain {m.domain ?? "—"} ·
                      {m.connectedAt ? ` connected ${m.connectedAt.toISOString().slice(0, 10)}` : " never connected"} ·
                      {m.lastSyncedAt ? ` synced ${m.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")}` : " never synced"}
                    </div>
                    {m.lastError && (
                      <div className="text-[11px] text-bad mt-1">Last error: {m.lastError}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {m.status === "PAUSED" ? (
                      <form action={setMailboxStatus.bind(null, m.id, "CONNECTED")}>
                        <button className="btn">Resume</button>
                      </form>
                    ) : (
                      <form action={setMailboxStatus.bind(null, m.id, "PAUSED")}>
                        <button className="btn">Pause</button>
                      </form>
                    )}
                    <form action={syncNowForm.bind(null, m.id)}><button className="btn">Sync now</button></form>
                    {oauthReady && m.provider === "gmail" && (
                      // eslint-disable-next-line @next/next/no-html-link-for-pages
                      <a href="/api/oauth/google/start" className="btn">Reconnect</a>
                    )}
                    <form action={disconnectMailbox.bind(null, m.id)}>
                      <button className="btn btn-danger">Disconnect</button>
                    </form>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[12px]">
                  <Cell label="Ramp stage" value={m.rampStage} />
                  <Cell label="Effective cap" value={`${cap}/day`}
                    hint={cap < m.dailyLimit ? `ramp caps ${m.dailyLimit}` : undefined} />
                  <Cell label="Sent today" value={String(m.sentDate === localDate(m.timezone, now) ? m.sentToday : 0)} />
                  <Cell label="Remaining" value={String(remaining)} />
                  <Cell label="Window" value={`${m.sendingStartTime}–${m.sendingEndTime}`}
                    hint={w.open ? "open now" : w.reason.toLowerCase().replace(/_/g, " ")} />
                  <Cell label="Last 7 days" value={`${s7} sent`} hint={`${b7} bounced`} />
                </div>

                <form action={updateMailboxLimits}
                  className="flex flex-wrap items-end gap-2 pt-2 border-t border-line">
                  <input type="hidden" name="id" value={m.id} />
                  <Field label="Daily limit">
                    <input name="dailyLimit" type="number" min={1} max={500} defaultValue={m.dailyLimit}
                      className="inp w-20" />
                  </Field>
                  <Field label="Ramp stage">
                    <select name="rampStage" defaultValue={m.rampStage} className="inp">
                      {["NEW", "RAMPING", "ESTABLISHED", "MANUAL"].map((r) => (
                        <option key={r} value={r}>
                          {r}{config.rampLimits[r] ? ` (≤${config.rampLimits[r]})` : " (use daily limit)"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Start"><input name="sendingStartTime" defaultValue={m.sendingStartTime} className="inp w-20" /></Field>
                  <Field label="End"><input name="sendingEndTime" defaultValue={m.sendingEndTime} className="inp w-20" /></Field>
                  <Field label="Timezone"><input name="timezone" defaultValue={m.timezone} className="inp w-44" /></Field>
                  <button className="btn">Save limits</button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      {config.emailMode !== "gmail" && (
        <Card title="Add a mock mailbox"
          subtitle="Demo mode only. A mock mailbox sends nothing — it records what would have been sent, so the queue, router and scheduler can be exercised end to end.">
          <form action={addMockMailbox} className="flex flex-wrap items-end gap-2">
            <Field label="Address">
              <input name="email" required placeholder="outreach@example.com" className="inp w-64" />
            </Field>
            <Field label="Display name"><input name="name" placeholder="Outreach" className="inp w-44" /></Field>
            <button className="btn">Add</button>
          </form>
        </Card>
      )}

      <Card title="How a mailbox gets chosen"
        subtitle="The router applies these in order, per recipient — not once per campaign">
        <ol className="space-y-2.5 text-[12px]">
          {[
            ["The campaign's sending pool",
             "A campaign can name the mailboxes it may use. Only those are considered. A campaign with no pool may use any mailbox."],
            ["The pharmacy's assigned mailbox",
             "The first successful send records who owns that relationship. Every later message — including one from a different campaign — goes from the same address while it stays usable."],
            ["Most capacity remaining",
             "Otherwise the mailbox with the most quota left. Deliberately not round-robin: a mailbox with nothing left must be skipped, not handed a message that then fails."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-2.5">
              <span className="shrink-0 w-5 h-5 rounded-full bg-accent/12 text-accent text-[11px]
                               font-semibold flex items-center justify-center">{i + 1}</span>
              <span>
                <span className="font-medium">{t}</span>
                <span className="block text-muted mt-0.5 leading-relaxed">{d}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-4 pt-3.5 hairline">
          <div className="text-[12px] font-medium mb-2">What happens when things change</div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Situation</th><th>What the system does</th></tr></thead>
              <tbody>
                {[
                  ["A reply arrives",
                   "It is answered from the mailbox that owns the thread — never a different one. The From address a pharmacy sees stays the same throughout the conversation."],
                  ["A reply lands in a different mailbox",
                   "It is still matched to the right pharmacy by thread id or Message-ID, and the conversation is owned by the mailbox that received it. Replies then go from that mailbox."],
                  ["The assigned mailbox is paused, over its cap or outside its window",
                   "The message is routed to another mailbox in the pool and the reroute is written to the audit log, so a changed sender is never silent."],
                  ["The assigned mailbox is disconnected",
                   "Existing threads keep their history and stay readable. New sends reroute; replying on an old thread is refused with the reason rather than quietly sent from somewhere else."],
                  ["A mailbox is deleted",
                   "Its pharmacies lose their assignment and are routed afresh. Messages and conversations are kept — the audit trail is never rewritten."],
                  ["Every mailbox in the pool is unusable",
                   "Nothing is sent. Claimed recipients are returned to the queue and the campaign resumes when a mailbox frees up; no recipient is failed for a mailbox-side problem."],
                  ["The account-wide daily limit is reached",
                   `Sending stops for the day across every campaign and mailbox. The ceiling is ${config.limits.globalDaily}/day (GLOBAL_DAILY_LIMIT) and applies on top of per-mailbox limits, so adding a mailbox cannot quietly raise total volume.`],
                ].map(([q, a]) => (
                  <tr key={q}>
                    <td className="text-[12px] font-medium align-top max-w-[240px]">{q}</td>
                    <td className="text-[12px] text-muted leading-relaxed">{a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card title="What is stored" className="text-[11px] text-muted">
        <div className="space-y-1">
          <div>· <span className="text-ink">Refresh token</span> — encrypted with AES-256-GCM using
            TOKEN_ENCRYPTION_KEY, server-side only, never sent to browser code.</div>
          <div>· <span className="text-ink">Access token</span> — never persisted; requested per
            call and discarded.</div>
          <div>· <span className="text-ink">Scopes</span> — gmail.send, gmail.readonly,
            userinfo.email. Nothing broader is requested.</div>
          <div>· Disconnecting deletes the stored refresh token rather than keeping a credential
            the system no longer uses.</div>
        </div>
      </Card>
    </>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-muted mb-0.5">{label}</span>
      {children}
    </label>
  );
}
