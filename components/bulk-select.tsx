"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icon";
import { Badge } from "./ui";

export type RegistryRow = {
  id: number;
  name: string;
  type: string | null;
  city: string | null;
  state: string | null;
  email: string | null;
  emailKind: string;
  phone: string | null;
  licence: string | null;
  verificationStatus: string;
  emailVerificationStatus: string;
  updatedAt: string;
};

export type BulkCampaign = { id: number; name: string };

export type BulkPermissions = {
  campaign: boolean;
  suppression: boolean;
  verification: boolean;
};

/**
 * The registry table, with selection.
 *
 * The rows are rendered here rather than on the server because selection state has to live
 * alongside them - a checkbox in one component and a row in another drift apart the moment the
 * page paginates.
 *
 * The action bar only appears once something is selected, and every destructive action states
 * what it will do to how many records before it will submit. A thousand-record action taken by
 * accident is not something an undo button fixes.
 */
export function SelectableRegistry({ rows, campaigns, back, can }: {
  rows: RegistryRow[]; campaigns: BulkCampaign[]; back: string; can: BulkPermissions;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(pageIds));
  const toggle = (id: number) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ids = [...selected].join(",");
  const n = selected.size;
  const anyAction = can.campaign || can.suppression || can.verification;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-9">
                <input type="checkbox" checked={allOnPage} onChange={toggleAll}
                  aria-label="Select every row on this page" />
              </th>
              <th>Pharmacy</th><th>Type</th><th>Location</th><th>Contact</th>
              <th>Licence</th><th>Status</th><th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={selected.has(p.id) ? "bg-accent/[0.07]" : ""}>
                <td>
                  <input type="checkbox" checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label={`Select ${p.name}`} />
                </td>
                <td className="max-w-[260px]">
                  <Link href={`/pharmacies/${p.id}`} className="link">{p.name}</Link>
                </td>
                <td className="text-muted max-w-[150px] truncate t-small">{p.type ?? "—"}</td>
                <td className="whitespace-nowrap">
                  {p.city ?? "—"} <span className="text-muted">{p.state ?? ""}</span>
                </td>
                <td className="max-w-[210px]">
                  <div className="truncate">
                    {p.email ?? <span className="text-muted">no email</span>}
                    {p.emailKind === "SHARED" && (
                      <span className="badge tone-warn ml-1.5">shared</span>
                    )}
                  </div>
                  <div className="t-small text-muted tabular-nums">{p.phone ?? "—"}</div>
                </td>
                <td className="t-mono text-muted">{p.licence ?? "—"}</td>
                <td>
                  <Badge value={p.verificationStatus} />
                  <div className="t-small text-muted mt-0.5">
                    email {p.emailVerificationStatus.replace(/_/g, " ").toLowerCase()}
                  </div>
                </td>
                <td className="text-muted tabular-nums t-small whitespace-nowrap">{p.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {n > 0 && anyAction && (
        <div className="sticky bottom-0 z-20 border-t border-line bg-panel shadow-pop px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge tone-accent">{n.toLocaleString()} selected</span>
            <button type="button" onClick={() => setSelected(new Set())}
              className="btn btn-sm btn-ghost">Clear</button>

            {can.campaign && campaigns.length > 0 && (
              <form action="/api/bulk" method="POST" className="flex items-center gap-1.5">
                <input type="hidden" name="action" value="ADD_TO_CAMPAIGN" />
                <input type="hidden" name="ids" value={ids} />
                <input type="hidden" name="back" value={back} />
                <select name="campaignId" className="inp" required defaultValue="">
                  <option value="" disabled>Add to campaign…</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn btn-sm btn-primary">
                  <Icon name="send" size={15} /> Add
                </button>
              </form>
            )}

            <a href={`/api/registry/export?ids=${ids}`} download className="btn btn-sm">
              <Icon name="upload_file" size={15} /> Export CSV
            </a>

            {can.verification && (
              <>
                <Confirm id="review" label="Send to review" icon="rule" action="MARK_REVIEW"
                  ids={ids} back={back} confirming={confirming} setConfirming={setConfirming}
                  prompt={`Send ${n.toLocaleString()} records to review? They stay out of outreach until someone settles them.`}
                  reasonLabel="Why (optional)" />
                <Confirm id="ready" label="Return to queue" icon="check_circle" action="MARK_READY"
                  ids={ids} back={back} confirming={confirming} setConfirming={setConfirming}
                  prompt={`Return ${n.toLocaleString()} records to the verification queue?`} />
                <Confirm id="exclude" label="Exclude" icon="block" danger action="EXCLUDE"
                  ids={ids} back={back} confirming={confirming} setConfirming={setConfirming}
                  prompt={`Exclude ${n.toLocaleString()} records from every campaign? Nothing is deleted and the reason goes on each record.`}
                  reasonLabel="Reason — required, and recorded" reasonRequired />
              </>
            )}

            {can.suppression && (
              <Confirm id="suppress" label="Suppress emails" icon="block" danger action="SUPPRESS"
                ids={ids} back={back} confirming={confirming} setConfirming={setConfirming}
                prompt={`Permanently suppress the addresses on ${n.toLocaleString()} records? It applies across every campaign.`}
                reasonLabel="Reason (optional)" />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Confirm({ id, label, icon, action, ids, back, danger, prompt, reasonLabel,
                   reasonRequired, confirming, setConfirming }: {
  id: string; label: string; icon: string; action: string; ids: string; back: string;
  danger?: boolean; prompt: string; reasonLabel?: string; reasonRequired?: boolean;
  confirming: string | null; setConfirming: (v: string | null) => void;
}) {
  if (confirming !== id)
    return (
      <button type="button" onClick={() => setConfirming(id)}
        className={`btn btn-sm ${danger ? "btn-danger" : ""}`}>
        <Icon name={icon as "block"} size={15} /> {label}
      </button>
    );

  return (
    <form action="/api/bulk" method="POST"
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-accent/40
                 bg-accent/[0.05] px-2.5 py-2 w-full">
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="ids" value={ids} />
      <input type="hidden" name="back" value={back} />
      <span className="t-small flex-1 min-w-[260px]">{prompt}</span>
      {reasonLabel && (
        <input name="reason" required={reasonRequired} className="inp w-60"
          placeholder={reasonLabel} />
      )}
      <button className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`}>Confirm</button>
      <button type="button" onClick={() => setConfirming(null)} className="btn btn-sm btn-ghost">
        Cancel
      </button>
    </form>
  );
}
