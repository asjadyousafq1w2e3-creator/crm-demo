"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./icon";
import { bulkTriage } from "@/lib/inbox/triage-actions";
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_TONE, type Category } from "@/lib/inbox/classify";

export type Row = {
  id: number; pharmacyId: number; pharmacy: string; where: string; contactEmail: string;
  subject: string | null; category: Category; categoryReason: string | null;
  categorySource: string; state: string; unread: boolean; snoozedUntil: string | null;
  owner: string | null; campaign: string | null; mailbox: string;
  lastAt: string; preview: string | null; lastDirection: string | null;
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  const days = Math.round(mins / 1440);
  return days < 30 ? `${days}d` : new Date(iso).toISOString().slice(0, 10);
};

/**
 * The reply list, with triage where the replies are.
 *
 * Selection lives with the rows, because the volume in a cold-outreach inbox is autoresponders
 * and out-of-office notices: clearing forty of them has to be one action. The category badge
 * carries its own reasoning in a tooltip - a label you cannot interrogate is one people stop
 * believing after the first time it is wrong.
 */
export function InboxList({ rows, operators, back }: {
  rows: Row[]; operators: { id: number; name: string }[]; back: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const ids = [...selected].join(",");

  return (
    <div className="space-y-2.5">
      <div className="card p-2.5 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 t-small px-1.5 cursor-pointer">
          <input type="checkbox" checked={allSelected} className="accent-[rgb(var(--accent))]"
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />
          {selected.size ? `${selected.size} selected` : "Select all"}
        </label>

        {selected.size > 0 && (
          <form action={bulkTriage} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="ids" value={ids} />
            <input type="hidden" name="back" value={back} />
            <button name="action" value="CLOSE" className="btn btn-sm btn-primary">
              <Icon name="task_alt" size={15} /> Close
            </button>
            <button name="action" value="MARK_READ" className="btn btn-sm">Mark read</button>
            <span className="flex items-center gap-1">
              <select name="days" defaultValue="3" className="input !w-auto !py-1 text-[13px]">
                {[1, 3, 7, 14].map((d) => <option key={d} value={d}>{d}d</option>)}
              </select>
              <button name="action" value="SNOOZE" className="btn btn-sm">Snooze</button>
            </span>
            <span className="flex items-center gap-1">
              <select name="assignedToId" defaultValue="" className="input !w-auto !py-1 text-[13px]">
                <option value="">Nobody</option>
                {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button name="action" value="ASSIGN" className="btn btn-sm">Assign</button>
            </span>
            <span className="flex items-center gap-1">
              <select name="category" defaultValue="" className="input !w-auto !py-1 text-[13px]">
                <option value="">Category…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>))}
              </select>
              <button name="action" value="CATEGORISE" className="btn btn-sm">Set</button>
            </span>
          </form>
        )}
      </div>

      <div className="card overflow-hidden divide-y divide-line/60">
        {rows.map((r) => (
          <div key={r.id} data-selected={selected.has(r.id)}
            className="flex items-start gap-3 px-4 py-3 hover:bg-high/60
                       data-[selected=true]:bg-accent-container/40 transition-colors">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
              className="mt-1.5 accent-[rgb(var(--accent))]"
              aria-label={`Select conversation with ${r.pharmacy}`} />

            <Link href={`/inbox/${r.id}`} className="min-w-0 flex-1 group">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {r.unread && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                  title="Unread" />}
                <span className={`t-body truncate group-hover:text-accent
                  ${r.unread ? "font-bold" : "font-semibold"}`}>{r.pharmacy}</span>

                <span className={`badge tone-${CATEGORY_TONE[r.category]}`}
                  title={r.categoryReason
                    ? `${r.categorySource === "OPERATOR" ? "Set by an operator" : "Sorted automatically"} — ${r.categoryReason}`
                    : undefined}>
                  {CATEGORY_LABEL[r.category]}
                  {r.categorySource === "OPERATOR" && " ✓"}
                </span>

                {r.state === "SNOOZED" && r.snoozedUntil && (
                  <span className="badge tone-neutral">
                    back {r.snoozedUntil.slice(0, 10)}
                  </span>
                )}
                {r.state === "CLOSED" && <span className="badge tone-neutral">closed</span>}

                <span className="t-small text-muted ml-auto tabular-nums shrink-0">
                  {ago(r.lastAt)}
                </span>
              </div>

              <p className="t-small text-muted truncate">
                {r.where && <>{r.where} · </>}{r.contactEmail}
                {r.campaign && <> · {r.campaign}</>}
                {r.owner ? <> · {r.owner}</> : <> · <span className="text-warn">unassigned</span></>}
              </p>

              {r.subject && <p className="t-small mt-0.5 truncate">{r.subject}</p>}
              {r.preview && (
                <p className="t-small text-muted mt-0.5 line-clamp-2">
                  {r.lastDirection === "OUTBOUND" && (
                    <span className="text-muted/70">You: </span>)}
                  {r.preview}
                </p>
              )}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
