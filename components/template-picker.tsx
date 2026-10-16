"use client";
import { useState } from "react";
import { Icon } from "./icon";
import type { CampaignTemplate } from "@/lib/campaign/templates";

/**
 * Pick a starting point, then change it.
 *
 * The template fills the form and then gets out of the way - what lands in the fields is an
 * ordinary editable draft, not a locked selection, because the wording that works is always the
 * one adjusted for the actual client. Choosing a second template replaces the draft, so there is
 * a confirmation when the current text has been edited: losing twenty minutes of writing to a
 * misclick is the kind of thing people only forgive once.
 */
export function TemplatePicker({ templates }: { templates: CampaignTemplate[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [steps, setSteps] = useState<CampaignTemplate["followUps"]>([]);
  /**
   * What was last written into the body by a template. Comparing against it is how "has the
   * operator typed anything since?" is answered without attaching listeners to a form this
   * component does not own - and it is exact, where a keystroke flag would also trip on an
   * edit that was undone.
   */
  const [applied, setApplied] = useState<string | null>(null);

  const field = (name: string) =>
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);

  const apply = (t: CampaignTemplate) => {
    const subject = field("subject");
    const body = field("bodyText");
    if (!subject || !body) return;

    // Only warn when there is real work to lose: something is written, and it is not simply
    // what the last template put there.
    const written = body.value.trim();
    const untouched = written === "" || written === (applied ?? "").trim();
    if (!untouched && active !== t.id &&
        !confirm("Replace the message you have written with this template?")) return;

    subject.value = t.subject;
    body.value = t.bodyText;
    // The form is uncontrolled, so React has to be told the values moved.
    for (const el of [subject, body])
      el.dispatchEvent(new Event("input", { bubbles: true }));

    const name = field("name");
    if (name && !name.value) name.value = t.name;

    setActive(t.id);
    setSteps(t.followUps);
    setApplied(t.bodyText);
    body.focus();
    body.setSelectionRange(body.value.length, body.value.length);
  };

  const chosen = templates.find((t) => t.id === active);

  return (
    <div className="space-y-2.5">
      {/* Carries the choice into the form submission so the follow-up steps are created too. */}
      <input type="hidden" name="templateId" value={active ?? ""} />

      <div className="card p-3">
        <p className="t-title">Start from a template</p>
        <p className="t-small text-muted mt-0.5">
          Fills the message, then it is yours to edit. Nothing is locked.
        </p>
      </div>

      <div className="space-y-1.5 max-h-[30rem] overflow-y-auto pr-0.5">
        {templates.map((t) => (
          <button key={t.id} type="button" onClick={() => apply(t)}
            data-active={active === t.id}
            className="card p-3 w-full text-left hover:border-accent/60 transition-colors
                       data-[active=true]:border-accent data-[active=true]:bg-accent-container/40">
            <span className="flex items-center gap-2">
              <span className="t-small font-semibold flex-1">{t.name}</span>
              {t.followUps.length > 0 && (
                <span className="badge tone-neutral shrink-0">
                  +{t.followUps.length} follow-up{t.followUps.length === 1 ? "" : "s"}
                </span>
              )}
              {active === t.id && <Icon name="task_alt" size={15} />}
            </span>
            <span className="block t-small text-muted mt-1 leading-snug">{t.purpose}</span>
          </button>
        ))}
      </div>

      {chosen && (
        <div className="card p-3 space-y-2">
          <p className="t-colhead text-muted">Why it is written this way</p>
          <p className="t-small text-muted leading-relaxed">{chosen.rationale}</p>

          {chosen.id === "reconnect" && (
            <p className="t-small text-warn leading-relaxed">
              Only use this on a list you really have contacted before. Claiming a previous
              conversation that never happened is found out in one reply.
            </p>
          )}

          {steps.length > 0 && (
            <>
              <p className="t-colhead text-muted pt-1">Follow-ups it will create</p>
              <ol className="t-small text-muted space-y-1">
                {steps.map((s, i) => {
                  const day = steps.slice(0, i + 1).reduce((a, x) => a + x.waitDays, 0);
                  return (
                    <li key={i} className="flex gap-2">
                      <span className="tabular-nums shrink-0">Day {day}</span>
                      <span className="truncate">
                        {s.subject || "same thread"} — {s.bodyText.split("\n")[2] ?? ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="t-small text-muted">
                Each goes only to recipients who have not replied. Editable afterwards on the
                campaign&apos;s Sequence tab.
              </p>
            </>
          )}

          <button type="button" onClick={() => { setActive(null); setSteps([]); setApplied(null); }}
            className="btn btn-sm w-full">Clear selection</button>
        </div>
      )}

      {/* Saving is a checkbox on the campaign form rather than a separate screen: the moment
          somebody knows a message is worth keeping is the moment they finish writing it. */}
      <label className="card p-3 flex gap-2.5 cursor-pointer hover:border-accent/50
        transition-colors">
        <input type="checkbox" name="saveAsTemplate" className="mt-0.5
          accent-[rgb(var(--accent))]" />
        <span>
          <span className="t-small font-semibold block">Save this wording as a template</span>
          <span className="t-small text-muted block mt-0.5">
            Keeps the subject and body for reuse, under the campaign name. It appears at the top
            of this list next time.
          </span>
        </span>
      </label>

      <div className="card p-3 t-small text-muted leading-relaxed">
        Every message gets your company name, postal address and an unsubscribe link appended
        automatically — commercial email legally requires them, so they are not something a
        template can forget.
      </div>
    </div>
  );
}
