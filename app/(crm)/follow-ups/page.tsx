import Link from "next/link";
import { requirePagePermission } from "@/lib/auth";
import { Card, Empty, Note, PageHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/icon";
import { TaskQueue } from "@/components/task-queue";
import { assignableOperators, KINDS, promoteDue, queue, queueStats, STALE_SNOOZES }
  from "@/lib/followup/service";
import type { Kind, Priority } from "@/lib/followup/service";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;

export default async function FollowUps({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requirePagePermission("followup.manage");
  const sp = await searchParams;

  // Done on load rather than only in the worker: a queue that empties when a background job
  // stops is a queue nobody can trust.
  await promoteDue();

  const filter = {
    assignedToId: sp.who === "me" ? session.userId
                : sp.who === "unassigned" ? ("unassigned" as const)
                : sp.who ? Number(sp.who) : undefined,
    kind: (sp.kind || undefined) as Kind | undefined,
    priority: (sp.priority || undefined) as Priority | undefined,
    search: sp.q,
  };

  const [board, stats, operators] = await Promise.all([
    queue(filter), queueStats(filter), assignableOperators(),
  ]);

  const backParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "done" && k !== "error")
    backParams.set(k, String(v));
  const back = `/follow-ups${backParams.toString() ? `?${backParams}` : ""}`;

  const chip = (label: string, params: Record<string, string | undefined>, active: boolean) => {
    const q = new URLSearchParams(backParams);
    for (const [k, v] of Object.entries(params)) { if (v) q.set(k, v); else q.delete(k); }
    return (
      <Link key={label} href={`/follow-ups?${q}`} data-active={active}
        className="badge tone-neutral data-[active=true]:bg-accent
                   data-[active=true]:text-accent-ink hover:bg-high transition-colors">
        {label}
      </Link>
    );
  };

  const filtered = Boolean(sp.who || sp.kind || sp.priority || sp.q);

  return (
    <>
      <PageHeader title="Follow-ups"
        subtitle="The day's work, oldest first. Nothing here sends on its own — a follow-up is a reminder for a person, and stays one."
        actions={filtered
          ? <Link href="/follow-ups" className="btn btn-sm">Clear filters</Link> : undefined} />

      {(sp.done || sp.error) && <Note tone={sp.error ? "bad" : "ok"}>{sp.error ?? sp.done}</Note>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? "bad" : undefined}
          hint="already past due" icon={<Icon name="warning" size={18} />} />
        <Stat label="Due today" value={stats.dueToday}
          hint="the actual to-do list" icon={<Icon name="schedule" size={18} />} />
        <Stat label="Upcoming" value={stats.upcoming} hint="scheduled ahead" />
        <Stat label="Unassigned" value={stats.unassigned}
          tone={stats.unassigned ? "warn" : undefined} hint="nobody has picked these up" />
        <Stat label="High priority" value={stats.highPriority} hint="flagged as urgent" />
        <Stat label="Done today" value={stats.completedToday} tone="ok"
          hint="completed since midnight" icon={<Icon name="task_alt" size={18} />} />
      </div>

      {stats.stale > 0 && (
        <Note tone="warn">
          <strong>{stats.stale} {stats.stale === 1 ? "task has" : "tasks have"} been pushed back{" "}
          {STALE_SNOOZES} times or more.</strong> A task deferred this often is usually one nobody
          intends to do. Worth cancelling it honestly rather than carrying it forward.
        </Note>
      )}

      <form className="card p-3 flex flex-wrap gap-2.5 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[11px] text-muted block mb-1">Search</label>
          <input name="q" defaultValue={sp.q ?? ""} className="input"
                 placeholder="pharmacy, city, email or note" />
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Owner</label>
          <select name="who" defaultValue={sp.who ?? ""} className="input">
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
            {operators.filter((o) => o.id !== session.userId).map((o) => (
              <option key={o.id} value={o.id}>{o.name || o.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Type</label>
          <select name="kind" defaultValue={sp.kind ?? ""} className="input">
            <option value="">Any</option>
            {KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">Priority</label>
          <select name="priority" defaultValue={sp.priority ?? ""} className="input">
            <option value="">Any</option>
            <option value="HIGH">High only</option>
            <option value="NORMAL">Normal</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {chip("Everything", { who: undefined, priority: undefined, kind: undefined }, !filtered)}
        {chip("Mine", { who: "me" }, sp.who === "me")}
        {chip("Unassigned", { who: "unassigned" }, sp.who === "unassigned")}
        {chip("High priority", { priority: "HIGH" }, sp.priority === "HIGH")}
        {chip("Calls", { kind: "CALL" }, sp.kind === "CALL")}
      </div>

      {board.actionable === 0 && board.later.length === 0 ? (
        <Card>
          <Empty action={<Link href="/inbox" className="btn btn-primary btn-sm">Open the inbox</Link>}>
            Nothing is due. Follow-ups are created from a conversation in the inbox or from a
            pharmacy record — they are never generated automatically.
          </Empty>
        </Card>
      ) : (
        <TaskQueue
          groups={[
            { key: "OVERDUE", title: "Overdue", tone: "bad" as const, rows: board.overdue,
              note: "Past due. These only get worse by waiting." },
            { key: "TODAY", title: "Due today", tone: "accent" as const, rows: board.today,
              note: "Today's list." },
            { key: "TOMORROW", title: "Tomorrow", tone: "muted" as const, rows: board.tomorrow },
            { key: "LATER", title: `Later${board.laterTotal > board.later.length
                ? ` · showing ${board.later.length} of ${board.laterTotal}` : ""}`,
              tone: "muted" as const, rows: board.later },
          ].filter((g) => g.rows.length).map((g) => ({
            ...g,
            rows: g.rows.map((t) => ({
              id: t.id,
              pharmacyId: t.pharmacyId,
              pharmacy: t.pharmacy.canonicalName,
              where: [t.pharmacy.city, t.pharmacy.state].filter(Boolean).join(", "),
              phone: t.pharmacy.phone,
              email: t.pharmacy.email,
              leadStatus: t.pharmacy.leadStatus,
              conversationId: t.conversationId,
              dueAt: t.dueAt.toISOString(),
              kind: t.kind,
              priority: t.priority,
              note: t.note,
              snoozeCount: t.snoozeCount,
              owner: t.assignedTo ? (t.assignedTo.name || t.assignedTo.email) : null,
            })),
          }))}
          operators={operators.map((o) => ({ id: o.id, name: o.name || o.email }))}
          back={back} />
      )}
    </>
  );
}
