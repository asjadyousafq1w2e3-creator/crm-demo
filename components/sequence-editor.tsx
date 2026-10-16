import Link from "next/link";
import { Icon } from "./icon";
import { Card, Note } from "./ui";
import { addStep, toggleStep, updateStep } from "@/lib/campaign/sequence-actions";
import { MAX_STEPS, MAX_WAIT_DAYS, MIN_WAIT_DAYS } from "@/lib/campaign/sequence";

export type StepRow = {
  id: number; stepNumber: number; waitDays: number; subject: string | null;
  bodyText: string; active: boolean; sent: number;
};

/**
 * The sequence, shown as a timeline rather than a list of forms.
 *
 * The thing an operator needs to judge is the spacing - four emails over five days is harassment
 * and the same four over a month is diligence - so each step is labelled with the day it lands
 * on, not just the gap since the last one. Steps that have already gone out are locked: editing
 * the text under a label people have already received would leave two different messages
 * recorded as the same step.
 */
export function SequenceEditor({ campaignId, first, steps, editable, stopped }: {
  campaignId: number;
  first: { subject: string; bodyText: string; sent: number };
  steps: StepRow[];
  editable: boolean;
  stopped: Record<string, number>;
}) {
  let day = 0;
  const dayOf = (s: StepRow) => (day += s.active ? s.waitDays : 0);

  return (
    <div className="space-y-3">
      <Note tone="info">
        <strong>A follow-up only goes to somebody who has not answered.</strong> A reply, a bounce
        or an unsubscribe stops every remaining step for that pharmacy immediately, and each wait
        is counted from when the previous message actually left — not from when the campaign
        started — so a slow queue never compresses the gaps.
      </Note>

      {/* Step 1 is the campaign's own message. */}
      <Card pad={false}>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2.5 border-b border-line/70">
          <span className="w-7 h-7 rounded-lg bg-accent text-accent-ink flex items-center
            justify-center t-small font-bold shrink-0">1</span>
          <div className="min-w-0">
            <p className="t-title">Day 0 · the first message</p>
            <p className="t-small text-muted truncate">{first.subject}</p>
          </div>
          <span className="badge tone-neutral ml-auto">{first.sent.toLocaleString()} sent</span>
          {editable && (
            <Link href={`/campaigns/${campaignId}?tab=message`} className="btn btn-sm">Edit</Link>
          )}
        </div>
        <pre className="px-4 py-3 whitespace-pre-wrap t-small text-muted font-sans
          max-h-24 overflow-hidden">{first.bodyText.slice(0, 400)}</pre>
      </Card>

      {steps.map((s) => {
        const landsOn = dayOf(s);
        const locked = s.sent > 0;
        return (
          <Card key={s.id} pad={false}
            className={s.active ? "" : "opacity-60"}>
            <div className="px-4 py-3 flex flex-wrap items-center gap-2.5 border-b border-line/70">
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center t-small
                font-bold shrink-0 ${s.active ? "bg-accent text-accent-ink"
                                              : "bg-sunken text-muted"}`}>
                {s.stepNumber}
              </span>
              <div className="min-w-0">
                <p className="t-title">
                  {s.active ? `Day ${landsOn}` : "Turned off"} · {s.waitDays} day
                  {s.waitDays === 1 ? "" : "s"} after step {s.stepNumber - 1}
                </p>
                <p className="t-small text-muted truncate">
                  {s.subject || "Replies on the same thread — no new subject"}
                </p>
              </div>

              <span className="badge tone-neutral ml-auto">{s.sent.toLocaleString()} sent</span>

              {editable && (
                <form action={toggleStep}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn btn-sm">
                    {s.active ? <><Icon name="pause" size={15} /> Turn off</>
                              : <><Icon name="play_arrow" size={15} /> Turn on</>}
                  </button>
                </form>
              )}
            </div>

            {editable && !locked ? (
              <form action={updateStep} className="p-4 space-y-2">
                <input type="hidden" name="id" value={s.id} />
                <div className="flex flex-wrap gap-2">
                  <label className="flex-1 min-w-[200px]">
                    <span className="text-[11px] text-muted block mb-1">
                      Subject — leave empty to reply on the original thread
                    </span>
                    <input name="subject" defaultValue={s.subject ?? ""} className="input"
                           placeholder="(same thread)" />
                  </label>
                  <label>
                    <span className="text-[11px] text-muted block mb-1">Wait</span>
                    <select name="waitDays" defaultValue={s.waitDays} className="input">
                      {[1, 2, 3, 4, 5, 7, 10, 14, 21, 30].filter(
                        (d) => d >= MIN_WAIT_DAYS && d <= MAX_WAIT_DAYS).map((d) => (
                        <option key={d} value={d}>{d} days</option>))}
                    </select>
                  </label>
                </div>
                <textarea name="bodyText" rows={5} required defaultValue={s.bodyText}
                  className="input w-full font-sans" />
                <button className="btn btn-primary btn-sm">Save step {s.stepNumber}</button>
              </form>
            ) : (
              <>
                <pre className="px-4 py-3 whitespace-pre-wrap t-small text-muted font-sans
                  max-h-32 overflow-hidden">{s.bodyText}</pre>
                {locked && (
                  <p className="px-4 pb-3 t-small text-muted">
                    Already sent to {s.sent.toLocaleString()}, so the wording is fixed. Turn it off
                    and add a new step rather than changing what people have received.
                  </p>
                )}
              </>
            )}
          </Card>
        );
      })}

      {editable && steps.length + 1 < MAX_STEPS && (
        <Card title={`Add step ${steps.length + 2}`}
          subtitle="Goes only to recipients who have not replied by then">
          <form action={addStep} className="space-y-2">
            <input type="hidden" name="campaignId" value={campaignId} />
            <div className="flex flex-wrap gap-2">
              <label className="flex-1 min-w-[200px]">
                <span className="text-[11px] text-muted block mb-1">
                  Subject — empty keeps it on the same thread, which reads as a real follow-up
                </span>
                <input name="subject" className="input" placeholder="(same thread)" />
              </label>
              <label>
                <span className="text-[11px] text-muted block mb-1">Wait after the last step</span>
                <select name="waitDays" defaultValue={4} className="input">
                  {[2, 3, 4, 5, 7, 10, 14, 21, 30].map((d) => (
                    <option key={d} value={d}>{d} days</option>))}
                </select>
              </label>
            </div>
            <textarea name="bodyText" rows={5} required className="input w-full font-sans"
              placeholder={"Short, and different from the first message.\n\nPersonalisation tokens work here exactly as they do in the first message."} />
            <button className="btn btn-primary btn-sm">
              <Icon name="add" size={15} /> Add step
            </button>
          </form>
        </Card>
      )}

      {Object.keys(stopped).length > 0 && (
        <Card title="Why sequences stopped"
          subtitle="Counted per recipient, so the numbers explain why some got more messages than others">
          <ul className="t-small space-y-1">
            {Object.entries(stopped).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
              <li key={reason} className="flex justify-between gap-4">
                <span className="text-muted">
                  {reason === "RUNNING" ? "still in the sequence" : reason.toLowerCase()}
                </span>
                <span className="tabular-nums font-semibold">{n.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
