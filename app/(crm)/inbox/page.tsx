import Link from "next/link";
import { requirePagePermission } from "@/lib/auth";
import { Card, Empty, Note, PageHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/icon";
import { InboxList } from "@/components/inbox-list";
import { Pager } from "@/components/ui";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/inbox/classify";
import { categoryCounts, inboxOptions, listConversations, viewCounts, VIEWS, wakeSnoozed }
  from "@/lib/inbox/triage";
import type { View } from "@/lib/inbox/triage";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

export default async function Inbox({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePagePermission("inbox.view");
  const sp = await searchParams;

  // A snooze that never comes back is worse than no snooze, so this does not depend on the
  // worker having run.
  await wakeSnoozed();

  const view = (sp.view as View) || "NEEDS_ME";
  const page = Math.max(1, Number(sp.page ?? 1));
  const filter = {
    view,
    category: (sp.category || undefined) as Category | undefined,
    campaignId: Number(sp.campaign) || undefined,
    mailboxId: Number(sp.mailbox) || undefined,
    assignedToId: Number(sp.owner) || undefined,
    search: sp.q,
    meId: session.userId,
  };

  const [{ rows, total, pages }, counts, cats, options] = await Promise.all([
    listConversations(filter, page),
    viewCounts(session.userId),
    categoryCounts(filter),
    inboxOptions(),
  ]);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "done" && k !== "error")
    params.set(k, String(v));
  const back = `/inbox${params.toString() ? `?${params}` : ""}`;

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(params);
    q.delete("page");
    for (const [k, v] of Object.entries(patch)) { if (v) q.set(k, v); else q.delete(k); }
    return `/inbox${q.toString() ? `?${q}` : ""}`;
  };

  // Only categories that actually occur are offered — a filter for something with no rows
  // behind it is a dead end dressed as a choice.
  const present = CATEGORIES.filter((c) => cats[c] > 0);

  return (
    <>
      <PageHeader title="Inbox"
        subtitle="Every reply matched back to the pharmacy that sent it. Replies are sorted on arrival, and the sorting says why — it never guesses when it is unsure."
        actions={
          <Link href="/follow-ups" className="btn btn-sm">
            <Icon name="schedule" size={16} /> Follow-ups
          </Link>
        } />

      {(sp.done || sp.error) && <Note tone={sp.error ? "bad" : "ok"}>{sp.error ?? sp.done}</Note>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="Needs attention" value={counts.NEEDS_ME}
          tone={counts.NEEDS_ME ? "warn" : undefined} hint="open, and written by a person"
          icon={<Icon name="mark_email_unread" size={18} />} />
        <Stat label="Unread" value={counts.UNREAD} hint="nobody has opened these" />
        <Stat label="Assigned to me" value={counts.MINE} hint="yours to answer" />
        <Stat label="Unassigned" value={counts.UNASSIGNED}
          tone={counts.UNASSIGNED ? "warn" : undefined} hint="nobody has picked these up" />
      </div>

      {/* Views ------------------------------------------------------------------ */}
      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Link key={v.key} href={href({ view: v.key === "NEEDS_ME" ? undefined : v.key })}
            title={v.hint} data-active={view === v.key}
            className="badge tone-neutral flex items-center gap-1.5 hover:bg-high
                       data-[active=true]:bg-accent data-[active=true]:text-accent-ink
                       transition-colors">
            {v.label}
            <span className="tabular-nums opacity-70">{counts[v.key]}</span>
          </Link>
        ))}
      </div>

      <form className="card p-3 flex flex-wrap gap-2.5 items-end">
        {view !== "NEEDS_ME" && <input type="hidden" name="view" value={view} />}
        <div className="flex-1 min-w-[220px]">
          <label className="text-[11px] text-muted block mb-1">Search</label>
          <input name="q" defaultValue={sp.q ?? ""} className="input"
                 placeholder="pharmacy, address, subject or message text" />
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Campaign</label>
          <select name="campaign" defaultValue={sp.campaign ?? ""} className="input">
            <option value="">All</option>
            {options.campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name.slice(0, 28)}</option>))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Mailbox</label>
          <select name="mailbox" defaultValue={sp.mailbox ?? ""} className="input">
            <option value="">All</option>
            {options.mailboxes.map((m) => (
              <option key={m.id} value={m.id}>{m.emailAddress}</option>))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Owner</label>
          <select name="owner" defaultValue={sp.owner ?? ""} className="input">
            <option value="">Anyone</option>
            {options.operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name || o.email}</option>))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      {/* Reply kinds ------------------------------------------------------------ */}
      {present.length > 1 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="t-colhead text-muted mr-1">Kind of reply</span>
          <Link href={href({ category: undefined })} data-active={!sp.category}
            className="badge tone-neutral hover:bg-high data-[active=true]:bg-accent
                       data-[active=true]:text-accent-ink transition-colors">All</Link>
          {present.map((c) => (
            <Link key={c} href={href({ category: c })} data-active={sp.category === c}
              className="badge tone-neutral flex items-center gap-1.5 hover:bg-high
                         data-[active=true]:bg-accent data-[active=true]:text-accent-ink
                         transition-colors">
              {CATEGORY_LABEL[c]}
              <span className="tabular-nums opacity-70">{cats[c]}</span>
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <Empty>
            {view === "NEEDS_ME"
              ? "Nothing needs attention. Out-of-office replies and autoresponders are filed away from this view on purpose — switch to Everything to see them."
              : "No conversations match this view."}
          </Empty>
        </Card>
      ) : (
        <InboxList
          rows={rows.map((c) => ({
            id: c.id,
            pharmacyId: c.pharmacyId,
            pharmacy: c.pharmacy.canonicalName,
            where: [c.pharmacy.city, c.pharmacy.state].filter(Boolean).join(", "),
            contactEmail: c.contactEmail,
            subject: c.subject,
            category: c.category as Category,
            categoryReason: c.categoryReason,
            categorySource: c.categorySource,
            state: c.state,
            unread: c.unread,
            snoozedUntil: c.snoozedUntil?.toISOString() ?? null,
            owner: c.assignedTo ? (c.assignedTo.name || c.assignedTo.email) : null,
            campaign: c.campaign?.name ?? null,
            mailbox: c.mailbox.emailAddress,
            lastAt: (c.lastMessageAt ?? c.updatedAt).toISOString(),
            preview: c.messages[0]?.bodyText?.slice(0, 180) ?? null,
            lastDirection: c.messages[0]?.direction ?? null,
          }))}
          operators={options.operators.map((o) => ({ id: o.id, name: o.name || o.email }))}
          back={back} />
      )}

      <Pager page={page} pages={pages} total={total} params={sp} />
    </>
  );
}
