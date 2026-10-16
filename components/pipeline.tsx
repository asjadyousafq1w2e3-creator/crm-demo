import Link from "next/link";
import { Icon, type IconName } from "./icon";
import { pipeline, type Stage, type StageState } from "@/lib/pipeline";

const MARK: Record<StageState, { icon: IconName; cls: string; label: string }> = {
  DONE:    { icon: "task_alt",      cls: "bg-ok-container text-ok",   label: "done" },
  CURRENT: { icon: "chevron_right", cls: "bg-accent text-accent-ink", label: "do this next" },
  BLOCKED: { icon: "block",         cls: "bg-bad-container text-bad", label: "blocked" },
  WAITING: { icon: "schedule",      cls: "bg-high text-muted",        label: "not yet" },
};

/**
 * The whole job on one screen, in order, with the next move named.
 *
 * Every screen in here belongs to one of seven steps, but a sidebar cannot say which step comes
 * after which, or which one is currently holding everything up. This can.
 */
export async function PipelineBoard() {
  const { stages, next } = await pipeline();

  return (
    <section className="space-y-3">
      {next ? (
        <div className="card p-4 flex flex-wrap items-center gap-4 border-accent/40
          bg-accent-container/40">
          <span className="w-9 h-9 rounded-xl bg-accent text-accent-ink flex items-center
            justify-center shrink-0">
            <Icon name="bolt" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="t-title">Do this next — {next.title.toLowerCase()}</p>
            <p className="t-small text-muted">{next.why}</p>
          </div>
          <Link href={next.href} className="btn btn-primary">{next.label}</Link>
        </div>
      ) : (
        <div className="card p-4 flex items-center gap-4">
          <span className="w-9 h-9 rounded-xl bg-ok-container text-ok flex items-center
            justify-center shrink-0">
            <Icon name="task_alt" size={20} />
          </span>
          <div>
            <p className="t-title">Every step has been through at least once</p>
            <p className="t-small text-muted">
              Keep going by importing a new state file or opening another campaign.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-2.5 grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {stages.map((s, i) => <StageCard key={s.key} stage={s} n={i + 1} />)}
      </div>
    </section>
  );
}

function StageCard({ stage, n }: { stage: Stage; n: number }) {
  const m = MARK[stage.state];
  const body = (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="t-colhead text-muted">Step {n}</span>
        <span className={`w-5 h-5 rounded-full flex items-center justify-center ${m.cls}`}
          title={m.label}>
          <Icon name={m.icon} size={13} />
        </span>
      </div>
      <p className="t-small font-semibold leading-snug">{stage.title}</p>
      <p className="mt-2 t-head tabular-nums leading-none">{stage.value.toLocaleString()}</p>
      <p className="t-small text-muted leading-snug">{stage.valueLabel}</p>
    </>
  );
  const tone = stage.state === "CURRENT" ? "border-accent/50" : "";
  return stage.action
    ? <Link href={stage.action.href} className={`card p-3 block hover:border-accent/60
        transition-colors ${tone}`} title={stage.purpose}>{body}</Link>
    : <div className={`card p-3 ${tone}`} title={stage.purpose}>{body}</div>;
}

/**
 * One line at the top of a page saying which step this is and where it leads. Pages are reached
 * from a search result or a bookmark as often as from the sidebar, so each one has to be able to
 * place itself.
 */
export async function StageBar({ stage: key }: { stage: string }) {
  const { stages } = await pipeline();
  const i = stages.findIndex((s) => s.key === key);
  if (i < 0) return null;
  const here = stages[i];
  const after = stages[i + 1];

  return (
    <p className="t-small text-muted flex flex-wrap items-center gap-x-2 gap-y-1 -mt-1">
      <span className="badge tone-neutral">Step {i + 1} of {stages.length}</span>
      <span>{here.purpose}</span>
      {after ? (
        <>
          <Icon name="chevron_right" size={14} />
          <span>then</span>
          <Link href={after.action?.href ?? "/"} className="link">{after.title.toLowerCase()}</Link>
        </>
      ) : null}
    </p>
  );
}
