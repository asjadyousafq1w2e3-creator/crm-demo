import { requirePagePermission, sessionCan } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Badge, Card, Note } from "@/components/ui";
import { config, liveSendingAllowed } from "@/lib/config";
import { LEAD_STATUSES, markRead } from "@/lib/inbox/service";
import { sendReplyForm, setLeadStatus } from "@/lib/inbox/actions";
import { setCategory, assignConversation, snoozeConversation, closeConversation,
         reopenConversation } from "@/lib/inbox/triage-actions";
import { createTask } from "@/lib/followup/actions";
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_TONE, type Category } from "@/lib/inbox/classify";
import { assignableOperators, KINDS, KIND_LABEL } from "@/lib/followup/service";
import { Icon } from "@/components/icon";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Conversation({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("inbox.view");
  const mayReply = await sessionCan("inbox.reply");
  const mayClassify = await sessionCan("registry.edit");
  const mayFollowUp = await sessionCan("followup.manage");
  const { id } = await params;
  const sp = await searchParams;
  const conversation = await prisma.conversation.findUnique({
    where: { id: Number(id) },
    include: {
      pharmacy: true, mailbox: true, campaign: { select: { id: true, name: true } },
      messages: { orderBy: { id: "asc" } },
    },
  });
  if (!conversation) notFound();

  // Opening a thread marks it read. The service is called directly rather than the action -
  // revalidatePath cannot run during render.
  if (conversation.unread) await markRead(conversation.id);

  const followUps = await prisma.followUp.findMany({
    where: { pharmacyId: conversation.pharmacyId, status: { in: ["PENDING", "DUE"] } },
    orderBy: { dueAt: "asc" },
  });
  const suppressed = await prisma.suppressionEntry.findUnique({
    where: { email: conversation.contactEmail.toLowerCase() } });
  const operators = await assignableOperators();
  const cat = conversation.category as Category;
  const back = `/inbox/${conversation.id}`;
  const live = liveSendingAllowed();
  const p = conversation.pharmacy;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/inbox" className="text-[12px] text-muted hover:underline">← Inbox</Link>
          <h1 className="text-lg font-semibold mt-0.5">{p.canonicalName}</h1>
          <div className="text-[12px] text-muted">
            {conversation.contactEmail} · {[p.city, p.state].filter(Boolean).join(", ")} ·
            thread on {conversation.mailbox.emailAddress}
            {conversation.campaign && (
              <> · <Link href={`/campaigns/${conversation.campaign.id}`} className="hover:underline">
                {conversation.campaign.name}</Link></>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge value={p.leadStatus} />
          <Link href={`/pharmacies/${p.id}`} className="btn">Record</Link>
        </div>
      </div>

      {/* Triage bar. What kind of reply this is, who owns it, and whether it still needs
          anybody - the three questions asked of every thread before it is read properly. */}
      <div className="card p-3 flex flex-wrap items-center gap-2.5">
        <span className={`badge tone-${CATEGORY_TONE[cat]}`}>{CATEGORY_LABEL[cat]}</span>
        <span className="t-small text-muted flex-1 min-w-[180px]">
          {conversation.categorySource === "OPERATOR" ? "Set by an operator" : "Sorted on arrival"}
          {conversation.categoryReason && <> — {conversation.categoryReason}</>}
        </span>

        <form action={setCategory} className="flex items-center gap-1">
          <input type="hidden" name="id" value={conversation.id} />
          <input type="hidden" name="back" value={back} />
          <select name="category" defaultValue={cat} className="input !w-auto !py-1 text-[13px]">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>))}
          </select>
          <button className="btn btn-sm">Change</button>
        </form>

        <form action={assignConversation} className="flex items-center gap-1">
          <input type="hidden" name="id" value={conversation.id} />
          <input type="hidden" name="back" value={back} />
          <select name="assignedToId" defaultValue={conversation.assignedToId ?? ""}
            className="input !w-auto !py-1 text-[13px]">
            <option value="">Unassigned</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name || o.email}</option>))}
          </select>
          <button className="btn btn-sm">Assign</button>
        </form>

        <form action={snoozeConversation} className="flex items-center gap-1">
          <input type="hidden" name="id" value={conversation.id} />
          <input type="hidden" name="back" value="/inbox" />
          <select name="days" defaultValue="3" className="input !w-auto !py-1 text-[13px]">
            {[1, 3, 7, 14].map((d) => <option key={d} value={d}>{d}d</option>)}
          </select>
          <button className="btn btn-sm"><Icon name="schedule" size={15} /> Snooze</button>
        </form>

        {conversation.state === "CLOSED" ? (
          <form action={reopenConversation}>
            <input type="hidden" name="id" value={conversation.id} />
            <input type="hidden" name="back" value={back} />
            <button className="btn btn-sm">Reopen</button>
          </form>
        ) : (
          <form action={closeConversation}>
            <input type="hidden" name="id" value={conversation.id} />
            <input type="hidden" name="back" value="/inbox" />
            <button className="btn btn-sm btn-primary">
              <Icon name="task_alt" size={15} /> Close
            </button>
          </form>
        )}
      </div>

      {conversation.state === "SNOOZED" && conversation.snoozedUntil && (
        <Note tone="info">
          Snoozed until {conversation.snoozedUntil.toISOString().slice(0, 10)}. It returns to the
          inbox on its own, and any new message brings it back immediately.
        </Note>
      )}

      {sp.sent && (
        <Note tone="ok">
          Reply sent from <strong>{conversation.mailbox.emailAddress}</strong>
          {config.emailMode !== "gmail"
            ? " through the mock provider — nothing left the application."
            : "."}
        </Note>
      )}
      {sp.error && <Note tone="bad">Reply not sent: {sp.error}</Note>}
      {suppressed && (
        <Note tone="bad">
          This address is suppressed ({suppressed.reason.toLowerCase()}). No further mail can be
          sent to it from any campaign.
        </Note>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="space-y-3">
          <Card title="Conversation"
            subtitle={`${conversation.messages.length} message${conversation.messages.length === 1 ? "" : "s"} · ${conversation.contactEmail}`}
            pad={false}>
          <div className="p-3.5 space-y-2">
            {conversation.messages.map((m) => (
              <div key={m.id}
                className={`card p-3 ${m.direction === "INBOUND" ? "" : "bg-raised ml-6"}`}>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span>
                    {m.direction === "INBOUND" ? "From" : "To"}{" "}
                    <span className="text-ink">{m.direction === "INBOUND" ? m.fromAddress : m.toAddress}</span>
                    {m.isBounce && <span className="badge tone-bad ml-2">bounce</span>}
                  </span>
                  <span>{(m.receivedAt ?? m.sentAt ?? m.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
                </div>
                {m.subject && <div className="text-[12px] font-medium mt-1">{m.subject}</div>}
                <pre className="whitespace-pre-wrap text-[12px] text-ink/90 mt-1.5 font-sans">
                  {m.bodyText ?? "(no plain-text body)"}
                </pre>
              </div>
            ))}
          </div>
          </Card>

          {mayReply ? (
          <form action={sendReplyForm.bind(null, conversation.id)} className="card p-3.5 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[13px] font-medium">Reply</div>
              <div className="text-[11px] text-muted">
                from <span className="text-ink">{conversation.mailbox.emailAddress}</span>
              </div>
            </div>
            <textarea name="body" rows={6} required className="input w-full font-sans"
              placeholder="Write a reply. It is sent on this thread, from this mailbox." />
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-muted">
                {config.emailMode !== "gmail"
                  ? "Demo mode: the reply is recorded but not transmitted."
                  : live.allowed
                    ? "Live mode: this will send a real email."
                    : `Live sending is off (${live.reason}) — the reply will be refused.`}
              </div>
              <button className="btn btn-primary" disabled={Boolean(suppressed)}>
                Send reply
              </button>
            </div>
          </form>
          ) : (
            <div className="card p-3 text-[12px] text-muted">
              Replying needs the <code>inbox.reply</code> permission, which your role does not have.
            </div>
          )}
        </div>

        <div className="space-y-3">
          {mayClassify && (
          <div className="card p-3.5 space-y-2">
            <div className="text-[13px] font-medium">Lead status</div>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STATUSES.map((s) => (
                <form key={s} action={setLeadStatus.bind(null, p.id, s)}>
                  <button className={`btn text-[11px] ${p.leadStatus === s ? "border-accent text-accent" : ""}`}>
                    {s.replace(/_/g, " ").toLowerCase()}
                  </button>
                </form>
              ))}
            </div>
            <p className="text-[11px] text-muted">
              A status set here is preserved — inbox sync never overwrites an operator
              classification. Marking a lead unsubscribed also adds the address to the global
              suppression list.
            </p>
          </div>
          )}

          {mayFollowUp && (
          <div className="card p-3.5 space-y-2">
            <div className="text-[13px] font-medium">Follow-up</div>
            {followUps.length > 0 && (
              <ul className="text-[11px] text-muted space-y-0.5">
                {followUps.map((f) => (
                  <li key={f.id}>· due {f.dueAt.toISOString().slice(0, 10)}{f.note ? ` — ${f.note}` : ""}</li>
                ))}
              </ul>
            )}
            <form action={createTask} className="space-y-1.5">
              <input type="hidden" name="pharmacyId" value={p.id} />
              <input type="hidden" name="conversationId" value={conversation.id} />
              <input type="hidden" name="back" value={back} />
              <select name="kind" defaultValue="EMAIL" className="input w-full">
                {KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>))}
              </select>
              <select name="priority" defaultValue="NORMAL" className="input w-full">
                <option value="NORMAL">Normal priority</option>
                <option value="HIGH">High priority</option>
              </select>
              <select name="days" defaultValue="3" className="input w-full">
                {[1, 2, 3, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>in {d} {d === 1 ? "day" : "days"}</option>))}
              </select>
              <input type="date" name="dueDate" className="input w-full"
                     title="Or pick an exact date" />
              <select name="assignedToId" defaultValue="" className="input w-full">
                <option value="">Nobody in particular</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.name || o.email}</option>))}
              </select>
              <input name="note" placeholder="What needs doing?" className="input w-full" />
              <button className="btn w-full">Add to the queue</button>
            </form>
          </div>
          )}

          <div className="card p-3.5 text-[11px] text-muted space-y-1.5">
            <div className="text-[12px] text-ink font-medium">Thread facts</div>
            <div>Owning mailbox: <span className="text-ink">{conversation.mailbox.emailAddress}</span></div>
            <div>Provider thread: <span className="font-mono break-all">{conversation.providerThreadId}</span></div>
            <div>Messages: {conversation.messages.length}</div>
            <div className="pt-1.5 hairline leading-relaxed">
              Replies always go from the owning mailbox, so this pharmacy only ever sees one
              sender. Inbound mail is matched by thread id or RFC Message-ID — never by subject
              line, which collides across every recipient of a campaign.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
