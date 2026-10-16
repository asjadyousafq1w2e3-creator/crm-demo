import { requirePagePermission, sessionCan } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, Empty, Note, PageHeader, Stat } from "@/components/ui";
import { campaignReview, startCampaign, setCampaignStatus, setCampaignPool, buildAudience }
  from "@/lib/campaign/actions";
import { audienceOptions, previewAudience } from "@/lib/campaign/audience";
import { renderBoth } from "@/lib/campaign/personalize";
import { simulateEvent } from "@/lib/mail/simulate-actions";
import { config } from "@/lib/config";
import { footerCompliance, footerProblem } from "@/lib/settings";
import { preflight } from "@/lib/campaign/preflight";
import { Icon } from "@/components/icon";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SequenceEditor } from "@/components/sequence-editor";
import { sequenceProgress } from "@/lib/campaign/sequence";

export const dynamic = "force-dynamic";

export default async function CampaignDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ built?: string; blocked?: string; kept?: string; tab?: string;
                           done?: string; error?: string }>;
}) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("campaign.view");
  const { id } = await params;
  const sp = searchParams ? await searchParams : undefined;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId)) notFound();

  const maySend = await sessionCan("campaign.send");
  const mayEdit = await sessionCan("campaign.edit");
  const tab = sp?.tab ?? "overview";
  const sequence = await sequenceProgress(campaignId);
  const sequenceSteps = await prisma.campaignStep.findMany({
    where: { campaignId }, orderBy: { stepNumber: "asc" } });

  const review = await campaignReview(campaignId);
  if (!review.campaign) notFound();
  const c = review.campaign;

  // Preview against a REAL selected recipient, never a fabricated example.
  const sample = await prisma.campaignRecipient.findFirst({
    where: { campaignId, status: { in: ["PENDING", "QUEUED", "SENT"] } },
    include: { pharmacy: true }, orderBy: { id: "asc" },
  });
  const preview = sample ? renderBoth(c.subject, c.bodyText, c.bodyHtml, sample.pharmacy) : null;

  // Checked on load as well as on submit, so the reason is on screen before the button is
  // pressed rather than after.
  const footer = await footerCompliance();
  const footerBlocker = footerProblem(footer);
  const checks = await preflight(campaignId);

  async function start() { "use server"; await startCampaign(campaignId); }
  async function pause() { "use server"; await setCampaignStatus(campaignId, "PAUSED"); }
  async function resume() { "use server"; await setCampaignStatus(campaignId, "RUNNING"); }
  async function cancel() { "use server"; await setCampaignStatus(campaignId, "CANCELLED"); }

  // Demo mode only: real sent recipients an operator can simulate an outcome against.
  const simulatable = config.emailMode !== "gmail"
    ? await prisma.campaignRecipient.findMany({
        where: { campaignId, status: { in: ["SENT", "REPLIED", "BOUNCED"] } },
        include: { pharmacy: { select: { canonicalName: true } } },
        orderBy: { sentAt: "desc" }, take: 10,
      })
    : [];

  const [options, poolPreview] = await Promise.all([
    audienceOptions(),
    // What the unfiltered pool looks like, so the numbers are on screen before anything is chosen.
    previewAudience({}),
  ]);
  const n = (k: string) => review.counts[k] ?? 0;
  const sent = n("SENT");
  const replied = n("REPLIED");
  const bounced = n("BOUNCED");
  // Provider-accepted messages: everything that got out the door, whatever happened next.
  const accepted = sent + replied + bounced;
  const recipients = Object.values(review.counts).reduce((a, b) => a + b, 0);

  // Interested / Not Interested are operator classifications on the pharmacy, not queue states.
  const leads = await prisma.pharmacy.groupBy({
    by: ["leadStatus"], _count: true,
    where: { campaignRecipients: { some: { campaignId } } },
  });
  const lead = (k: string) => leads.find((l) => l.leadStatus === k)?._count ?? 0;

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/campaigns" className="text-[12px] link">← Campaigns</Link>
      <PageHeader title={c.name} subtitle={c.subject}
        actions={
          <>
            {maySend && c.status === "RUNNING" &&
              <form action={pause}><button className="btn">Pause</button></form>}
            {maySend && c.status === "PAUSED" &&
              <form action={resume}><button className="btn">Resume</button></form>}
            {maySend && !["COMPLETED", "CANCELLED"].includes(c.status) &&
              <form action={cancel}><button className="btn btn-danger">Cancel</button></form>}
          </>
        }>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <Badge value={c.status} />
          <span className="text-[12px] text-muted">
            {c.sendingStartTime}–{c.sendingEndTime} {c.timezone} · limit {c.dailyLimit}/day ·{" "}
            {c.useAssignedMailbox ? "same sender per pharmacy" : "sender picked by capacity"}
          </span>
        </div>
      </PageHeader>

      {sp?.built !== undefined && (
        <Note tone={Number(sp.built) ? "ok" : "warn"}>
          Recipient list built: <strong>{Number(sp.built).toLocaleString()}</strong> eligible
          {Number(sp.blocked ?? 0) > 0 && (
            <> and {Number(sp.blocked).toLocaleString()} blocked — each blocked row carries the rule
            that stopped it, below.</>
          )}
          {Number(sp.kept ?? 0) > 0 && (
            <> <strong>{Number(sp.kept).toLocaleString()}</strong> had already been contacted by
            this campaign and were left untouched, so nobody is written to twice.</>
          )}
        </Note>
      )}

      {config.emailMode !== "gmail" && (
        <Note tone="warn">
          <span className="badge tone-warn mr-2">Demo email mode</span>
          Sends are simulated end to end. Real delivery needs both <code>EMAIL_MODE=gmail</code>
          {" "}and <code>ENABLE_LIVE_EMAIL_SENDING=true</code>.
        </Note>
      )}

      {(sp?.done || sp?.error) && (
        <Note tone={sp?.error ? "bad" : "ok"}>{sp?.error ?? sp?.done}</Note>
      )}

      {footerBlocker && (
        <Note tone="bad">
          <strong>This campaign cannot start.</strong> {footerBlocker}{" "}
          <Link href="/settings" className="link">Open settings</Link>.
        </Note>
      )}

      {/* Checked against the real recipient list, before anything is sent. */}
      {checks.filter((c) => c.severity !== "BLOCK").length > 0 && (
        <Card title="Before you send"
          subtitle="Measured against this campaign's own audience — not a generic checklist">
          <ul className="space-y-2.5">
            {checks.filter((c) => c.severity !== "BLOCK").map((c, i) => (
              <li key={i} className="flex gap-2.5">
                <span className={`badge shrink-0 mt-0.5 ${
                  c.severity === "WARN" ? "tone-warn" : "tone-neutral"}`}>
                  {c.severity === "WARN" ? "worth fixing" : "note"}
                </span>
                <span className="min-w-0">
                  <span className="t-small font-semibold block">{c.title}</span>
                  {c.detail && <span className="t-small text-muted block">{c.detail}</span>}
                  {c.fix && <span className="t-small block mt-0.5">→ {c.fix}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p data-ui="description" className="t-small text-muted mt-3 pt-3 hairline">
            There is no spam-word list here on purpose. Receivers score on authentication,
            sending history and how recipients react — not vocabulary — and writing to dodge a
            classifier is evasion rather than deliverability.
          </p>
        </Card>
      )}

      {/* Overview is the campaign as it stands; Sequence is what it will send and when. Two
          different questions, and answering both on one scroll made neither readable. */}
      <div className="flex flex-wrap gap-1.5">
        {([["overview", "Overview"],
           ["sequence", (() => {
             const n = sequenceSteps.filter((x) => x.active).length + 1;
             return `Sequence · ${n} ${n === 1 ? "step" : "steps"}`;
           })()],
          ] as const).map(([key, label]) => (
          <Link key={key}
            href={`/campaigns/${campaignId}${key === "overview" ? "" : `?tab=${key}`}`}
            data-active={tab === key}
            className="badge tone-neutral hover:bg-high data-[active=true]:bg-accent
                       data-[active=true]:text-accent-ink transition-colors">
            {label}
          </Link>
        ))}
      </div>

      {tab === "sequence" ? (
        <SequenceEditor
          campaignId={campaignId}
          first={{ subject: c.subject, bodyText: c.bodyText,
                   sent: sequence.steps.find((x) => x.stepNumber === 1)?.sent ?? sent }}
          steps={sequenceSteps.map((x) => ({
            id: x.id, stepNumber: x.stepNumber, waitDays: x.waitDays, subject: x.subject,
            bodyText: x.bodyText, active: x.active,
            sent: sequence.steps.find((y) => y.stepNumber === x.stepNumber)?.sent ?? 0,
          }))}
          editable={mayEdit && !["COMPLETED", "CANCELLED"].includes(c.status)}
          stopped={sequence.stopped} />
      ) : (
      <>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
        <Stat label="Recipients" value={recipients} />
        <Stat label="Eligible" value={review.eligible} />
        <Stat label="Blocked" value={review.blocked} />
        <Stat label="Queued" value={n("QUEUED")} />
        <Stat label="Scheduled" value={n("SCHEDULED")} />
        <Stat label="Sent" value={sent} hint="accepted by provider" />
        <Stat label="Failed" value={n("FAILED")} hint="provider rejected the call" />
        <Stat label="Bounced" value={bounced}
          hint={accepted ? `${((bounced / accepted) * 100).toFixed(1)}% bounce rate` : undefined} />
        <Stat label="Replies" value={replied}
          hint={accepted ? `${((replied / accepted) * 100).toFixed(1)}% reply rate` : undefined} />
        <Stat label="Interested" value={lead("INTERESTED")} />
        <Stat label="Not interested" value={lead("NOT_INTERESTED")} />
        {/* The pharmacy's lead status, not the queue state: someone who unsubscribes after a
            message was delivered leaves the recipient row as SENT. */}
        <Stat label="Unsubscribed" value={lead("UNSUBSCRIBED")} />
      </div>

      {/* ------------------------------------------------------------- sending from */}
      <div className="card">
        <div className="card-hd">
          <div>
            <h2 className="card-title">Sending from</h2>
            <p className="card-sub mt-0.5">
              {review.poolIsExplicit
                ? `${review.mailboxes.length} mailbox(es) selected for this campaign`
                : "Any eligible mailbox — no pool selected"}
            </p>
          </div>
          <span className="text-[11px] text-muted">
            {review.dailyCapacity.toLocaleString()} sends available today
          </span>
        </div>

        <div className="p-3.5">
          {review.allMailboxes.length === 0 ? (
            <Empty action={<Link href="/settings/mailboxes" className="btn btn-primary">
              Connect a mailbox</Link>}>
              No mailboxes exist yet, so this campaign has nothing to send from.
            </Empty>
          ) : (
            <form action={setCampaignPool.bind(null, campaignId)} className="space-y-3">
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {review.allMailboxes.map((m) => {
                  const inPool = !review.poolIsExplicit || review.poolIds.includes(m.id);
                  const state = review.mailboxStatus.find((x) => x.id === m.id);
                  const owns = review.assignedCounts.find((a) => a.mailboxId === m.id)?.count ?? 0;
                  return (
                    <label key={m.id}
                      className={`flex gap-2.5 rounded-md border p-2.5 cursor-pointer transition-colors
                        ${inPool ? "border-accent/50 bg-accent/[0.05]" : "border-line hover:border-accent/30"}`}>
                      <input type="checkbox" name="mailboxId" value={m.id}
                        defaultChecked={review.poolIsExplicit ? review.poolIds.includes(m.id) : false}
                        className="mt-0.5" disabled={!mayEdit} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium truncate">{m.emailAddress}</span>
                        <span className="block text-[11px] text-muted">
                          {m.rampStage.toLowerCase()} · {state?.remaining ?? 0} left today
                        </span>
                        {state?.blockedReason
                          ? <span className="badge tone-warn mt-1">{state.blockedReason}</span>
                          : inPool
                            ? <span className="badge tone-ok mt-1">available</span>
                            : <span className="badge tone-neutral mt-1">not in this pool</span>}
                        {owns > 0 && (
                          <span className="block text-[10px] text-muted mt-1">
                            already owns {owns.toLocaleString()} of these pharmacies
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>

              <label className="flex items-start gap-2.5 text-[12px]">
                <input type="checkbox" name="useAssignedMailbox" disabled={!mayEdit}
                  defaultChecked={c.useAssignedMailbox} className="mt-0.5" />
                <span>
                  <span className="font-medium">Keep the same sender per pharmacy</span>
                  <span className="block text-[11px] text-muted mt-0.5">
                    A pharmacy already contacted from one address keeps hearing from that address,
                    even in later campaigns. Turning this off lets the router pick purely on
                    available capacity — faster, but the recipient may see a new sender.
                  </span>
                </span>
              </label>

              {mayEdit && (
                <div className="flex items-center gap-2">
                  <button className="btn">Save sending pool</button>
                  <span className="text-[11px] text-muted">
                    Leave every box unticked to allow any eligible mailbox.
                  </span>
                </div>
              )}
            </form>
          )}

          {review.assignedCounts.length > 0 && (
            <p data-ui="description" className="text-[11px] text-muted mt-3 pt-3 hairline">
              {review.assignedCounts.map((a) => `${a.count.toLocaleString()} → ${a.email}`).join(" · ")}
              {" "}already have an owning mailbox from an earlier conversation.
            </p>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Recipients"
          subtitle="Filters narrow the pool; eligibility still decides who is actually queued">
          <div className="space-y-2.5">
          {mayEdit && (
            <form action={buildAudience.bind(null, campaignId)} className="space-y-3">
              <fieldset>
                <legend className="t-small text-muted mb-1.5">
                  States <span className="text-muted">· none selected means every state</span>
                </legend>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {options.states.map((s) => (
                    <label key={s.value}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1
                        cursor-pointer hover:border-accent/40 transition-colors">
                      <input type="checkbox" name="state" value={s.value} />
                      <span className="t-small font-medium">{s.value}</span>
                      <span className="t-small text-muted ml-auto tabular-nums">{s.count}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="t-small text-muted mb-1.5">
                  Pharmacy type <span className="text-muted">· none means every type</span>
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {options.types.slice(0, 10).map((t) => (
                    <label key={t.value}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1
                        cursor-pointer hover:border-accent/40 transition-colors">
                      <input type="checkbox" name="pharmacyType" value={t.value} />
                      <span className="t-small">{t.value.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="t-small text-muted tabular-nums">{t.count}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="t-small text-muted mb-1.5">
                  Address kind <span className="text-muted">· none means both</span>
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {options.kinds.map((k) => (
                    <label key={k.value}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1
                        cursor-pointer hover:border-accent/40 transition-colors">
                      <input type="checkbox" name="emailKind" value={k.value} />
                      <span className="t-small">
                        {k.value === "PERSONAL" ? "named person"
                          : k.value === "SHARED" ? "shared inbox" : k.value.toLowerCase()}
                      </span>
                      <span className="t-small text-muted tabular-nums">{k.count}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block t-small text-muted mb-1">Name or city contains</span>
                  <input name="search" className="input" placeholder="optional" />
                </label>
                <label className="block">
                  <span className="block t-small text-muted mb-1">
                    Cap <span className="text-muted">· optional</span>
                  </span>
                  <input name="limit" type="number" min={1} className="input" placeholder="e.g. 250" />
                </label>
              </div>

              <label className="flex items-start gap-2 t-small">
                <input type="checkbox" name="excludeContacted" defaultChecked className="mt-0.5" />
                <span>
                  Only pharmacies never contacted
                  <span className="block text-muted">
                    Leaves out anyone any campaign has already written to.
                  </span>
                </span>
              </label>

              <button className="btn btn-primary">
                <Icon name="group" size={16} /> Build the recipient list
              </button>
            </form>
          )}

          <div className="pt-3 hairline">
            <div className="t-small text-muted mb-1.5">
              The whole registry, before any filter
            </div>
            <div className="flex flex-wrap gap-3 t-small">
              <span><strong className="tabular-nums">{poolPreview.matching.toLocaleString()}</strong> records</span>
              <span className={poolPreview.eligible ? "text-ok" : "text-warn"}>
                <strong className="tabular-nums">{poolPreview.eligible.toLocaleString()}</strong> eligible
              </span>
              {poolPreview.suppressed > 0 && (
                <span className="text-bad">
                  <strong className="tabular-nums">{poolPreview.suppressed.toLocaleString()}</strong> suppressed
                </span>
              )}
            </div>
            {poolPreview.reasons.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {poolPreview.reasons.map((r) => (
                  <li key={r.reason} className="flex justify-between t-small">
                    <span className="text-muted">{r.reason}</span>
                    <span className="tabular-nums">{r.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {review.blockedReasons.length > 0 && (
            <div className="pt-2 border-t border-line">
              <div className="text-[11px] text-muted mb-1">Why recipients are blocked</div>
              {review.blockedReasons.slice(0, 6).map((b) => (
                <div key={b.reason} className="flex justify-between text-[12px] py-0.5">
                  <span className="text-muted truncate max-w-[240px]">{b.reason}</span>
                  <span className="tabular-nums">{b.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          </div>
        </Card>

        <Card title="Review before starting"
          subtitle="What would happen if you pressed start right now">
          <div className="space-y-2">
          <dl className="text-[13px] space-y-1">
            {[["Eligible now", review.eligible], ["Blocked", review.blocked],
              ["Mailboxes in the pool", review.mailboxes.length],
              ["Usable right now",
               review.mailboxStatus.filter((m) => m.inPool && !m.blockedReason).length],
              ["Daily capacity today", review.dailyCapacity],
              ["Account headroom today", review.accountHeadroom],
              ["Estimated sending days", review.estimatedDays ?? "—"]].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between border-b border-line/40 pb-1">
                <dt className="text-muted">{k}</dt>
                <dd className="tabular-nums">{typeof v === "number" ? v.toLocaleString() : v}</dd>
              </div>
            ))}
          </dl>
          {review.eligible === 0 ? (
            <div className="text-[12px] text-warn pt-1">
              No eligible recipients. Campaign eligibility requires a VERIFIED pharmacy with an
              ACTIVE licence, OPEN status, independent ownership and a VALID email — no
              verification has been run yet, so this is expected.
            </div>
          ) : maySend ? (
            <form action={start}>
              <button className="btn btn-primary w-full justify-center">
                Start campaign — queue {review.eligible.toLocaleString()} recipients
              </button>
            </form>
          ) : (
            <p className="text-[12px] text-muted pt-1">
              {review.eligible.toLocaleString()} recipients are ready. Starting a campaign needs the
              <code className="mx-1">campaign.send</code> permission, which your role does not have.
            </p>
          )}
          </div>
        </Card>
      </div>

      {config.emailMode !== "gmail" && maySend && (
        <Card title="Simulate an outcome"
          subtitle="Demo mode only — refused outright when EMAIL_MODE=gmail">
          <p className="text-[11px] text-muted">
            Demo mode only — refused outright when EMAIL_MODE=gmail, so simulated events can never
            be mixed into a real mailbox&apos;s history. Each one runs the same code path the real
            event would: a reply lands in the inbox, a bounce suppresses the address, an
            unsubscribe is permanent, a failure counts toward the auto-pause streak.
          </p>
          {simulatable.length === 0 ? (
            <Empty>Nothing has been sent on this campaign yet.</Empty>
          ) : (
            <form action={simulateEvent.bind(null, campaignId)}
              className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="block text-[11px] text-muted mb-1">Recipient</span>
                <select name="recipientId" className="inp max-w-[320px]">
                  {simulatable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.pharmacy.canonicalName} · {r.recipientEmail}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] text-muted mb-1">Event</span>
                <select name="kind" className="inp" defaultValue="REPLY">
                  <option value="REPLY">Reply</option>
                  <option value="BOUNCE">Bounce</option>
                  <option value="UNSUBSCRIBE">Unsubscribe</option>
                  <option value="FAILURE">Send failure</option>
                </select>
              </label>
              <button className="btn">Simulate</button>
            </form>
          )}
        </Card>
      )}

      <Card title="Preview"
        subtitle={sample
          ? `Rendered against a real recipient: ${sample.pharmacy.canonicalName}`
          : "Build the recipient list to preview against a real record"}>
        {preview ? (
          <div className="space-y-2 text-[13px]">
            <div><span className="text-muted">Subject: </span>{preview.subject}</div>
            <pre className="whitespace-pre-wrap text-[12px] bg-bg border border-line rounded p-2.5">
{preview.bodyText}</pre>
          </div>
        ) : <Empty>Build the recipient list to preview against a real record.</Empty>}
      </Card>
      </>
      )}
    </div>
  );
}
