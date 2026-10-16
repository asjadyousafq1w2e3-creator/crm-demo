"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon } from "./icon";
import { bulkTasks, completeTask, snoozeTask } from "@/lib/followup/actions";

export type Task = {
  id: number; pharmacyId: number; pharmacy: string; where: string;
  phone: string | null; email: string | null; leadStatus: string;
  conversationId: number | null; dueAt: string; kind: string; priority: string;
  note: string | null; snoozeCount: number; owner: string | null;
};
export type Group = {
  key: string; title: string; tone: "bad" | "accent" | "muted"; rows: Task[]; note?: string;
};

const KIND_ICON: Record<string, "mail" | "person" | "fact_check"> = {
  EMAIL: "mail", CALL: "person", CHECK: "fact_check",
};

/**
 * The queue, with selection living alongside the rows that own it.
 *
 * Rows are rendered here rather than on the server so a selection survives every interaction on
 * the page. Clearing a morning's work is the thing people stop doing when it costs one round
 * trip per task, so the bulk bar is the point of the component, not a decoration on it.
 */
export function TaskQueue({ groups, operators, back }: {
  groups: Group[]; operators: { id: number; name: string }[]; back: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const all = groups.flatMap((g) => g.rows.map((r) => r.id));
  const ids = [...selected].join(",");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const overdueBy = (iso: string) =>
    Math.round((today.getTime() - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="card p-3 flex flex-wrap items-center gap-2 sticky top-[3.75rem] z-20
          border-accent/40 bg-accent-container/50 backdrop-blur">
          <span className="t-small font-semibold">
            {selected.size} selected
          </span>
          <form action={bulkTasks} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="ids" value={ids} />
            <input type="hidden" name="back" value={back} />
            <button name="bulk" value="COMPLETE" className="btn btn-sm btn-primary">
              <Icon name="task_alt" size={15} /> Mark done
            </button>
            <span className="flex items-center gap-1">
              <select name="days" defaultValue="3" className="input !w-auto !py-1 text-[13px]">
                {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
              <button name="bulk" value="SNOOZE" className="btn btn-sm">Push back</button>
            </span>
            <span className="flex items-center gap-1">
              <select name="assignedToId" defaultValue="" className="input !w-auto !py-1 text-[13px]">
                <option value="">Unassigned</option>
                {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button name="bulk" value="ASSIGN" className="btn btn-sm">Assign</button>
            </span>
            <button name="bulk" value="CANCEL" className="btn btn-sm btn-danger">Cancel</button>
          </form>
          <button type="button" onClick={() => setSelected(new Set())}
            className="btn btn-sm ml-auto">Clear</button>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="card overflow-hidden">
          <div className="px-4 py-2.5 flex items-center gap-2.5 border-b border-line/70">
            <span className={`w-1.5 h-1.5 rounded-full ${
              g.tone === "bad" ? "bg-bad" : g.tone === "accent" ? "bg-accent" : "bg-muted"}`} />
            <h2 className="t-title">{g.title}</h2>
            <span className="badge tone-neutral">{g.rows.length}</span>
            {g.note && <span className="t-small text-muted hidden md:inline">{g.note}</span>}
            <button type="button" className="btn btn-sm ml-auto"
              onClick={() => setSelected((s) => {
                const n = new Set(s);
                const every = g.rows.every((r) => n.has(r.id));
                g.rows.forEach((r) => every ? n.delete(r.id) : n.add(r.id));
                return n;
              })}>
              {g.rows.every((r) => selected.has(r.id)) ? "Deselect" : "Select"} group
            </button>
          </div>

          <ul className="divide-y divide-line/60">
            {g.rows.map((t) => {
              const late = g.key === "OVERDUE" ? overdueBy(t.dueAt) : 0;
              return (
                <li key={t.id} data-selected={selected.has(t.id)}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-high/60
                             data-[selected=true]:bg-accent-container/40 transition-colors">
                  <input type="checkbox" checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)} className="mt-1 accent-[rgb(var(--accent))]"
                    aria-label={`Select follow-up for ${t.pharmacy}`} />

                  <span className="mt-0.5 text-muted" title={t.kind.toLowerCase()}>
                    <Icon name={KIND_ICON[t.kind] ?? "mail"} size={17} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/pharmacies/${t.pharmacyId}`}
                        className="t-body font-semibold hover:text-accent truncate">
                        {t.pharmacy}
                      </Link>
                      {t.priority === "HIGH" && <span className="badge tone-bad">high</span>}
                      {t.snoozeCount >= 3 && (
                        <span className="badge tone-warn"
                          title="Pushed back repeatedly — worth deciding about rather than deferring again">
                          pushed back {t.snoozeCount}×
                        </span>
                      )}
                      {late > 0 && (
                        <span className="badge tone-bad">
                          {late} {late === 1 ? "day" : "days"} late
                        </span>
                      )}
                    </div>

                    <p className="t-small text-muted truncate">
                      {t.where}
                      {t.phone && <> · <a href={`tel:${t.phone}`} className="link">{t.phone}</a></>}
                      {t.email && <> · {t.email}</>}
                      {t.owner ? <> · {t.owner}</> : <> · <span className="text-warn">unassigned</span></>}
                    </p>

                    {t.note && <p className="t-small mt-1 text-ink/90">{t.note}</p>}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {t.conversationId && (
                      <Link href={`/inbox/${t.conversationId}`} className="btn btn-sm"
                        title="Open the conversation this came from">
                        <Icon name="mail" size={15} />
                      </Link>
                    )}
                    <form action={snoozeTask}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="days" value="3" />
                      <input type="hidden" name="back" value={back} />
                      <button className="btn btn-sm" title="Push back three days">
                        <Icon name="schedule" size={15} />
                      </button>
                    </form>
                    <form action={completeTask}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="back" value={back} />
                      <button className="btn btn-sm btn-primary" title="Mark done">
                        <Icon name="task_alt" size={15} />
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {all.length > 0 && (
        <p className="t-small text-muted">
          {all.length} {all.length === 1 ? "task" : "tasks"} shown. Selecting rows reveals bulk
          actions at the top.
        </p>
      )}
    </div>
  );
}
