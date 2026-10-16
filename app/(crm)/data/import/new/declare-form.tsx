"use client";
import { useMemo, useState } from "react";
import { suggestMapping, type FieldSpec } from "@/lib/import/fields";
import { Icon } from "@/components/icon";

/**
 * Column declaration and mapping.
 *
 * The operator types their file's own headers, and the mapping is guessed from them; every guess
 * is visible and changeable, because a wrong guess here quietly corrupts everything downstream.
 */
export function DeclareForm({ fields }: { fields: FieldSpec[] }) {
  const [raw, setRaw] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const columns = useMemo(
    () => raw.split(/[\n,]+/).map((c) => c.trim()).filter(Boolean), [raw]);
  const suggested = useMemo(() => suggestMapping(columns), [columns]);

  const valueFor = (field: string) =>
    overrides[field] ?? (suggested as Record<string, string>)[field] ?? "";

  const duplicates = useMemo(() => {
    const lower = columns.map((c) => c.toLowerCase());
    return columns.filter((c, i) => lower.indexOf(c.toLowerCase()) !== i);
  }, [columns]);

  const emailChosen = Boolean(valueFor("email"));
  const nameChosen = Boolean(valueFor("name"));
  const mappedCount = fields.filter((f) => valueFor(f.field)).length;

  return (
    <>
      <div className="card">
        <div className="card-hd">
          <div>
            <h2 className="card-title">The file&apos;s columns</h2>
            <p className="card-sub mt-0.5">
              Paste the header row, or type the column names one per line
            </p>
          </div>
          <span className="t-small text-muted">
            {columns.length} column{columns.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="p-3.5 space-y-3">
          <textarea name="columns" required rows={4} value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="input font-mono text-[0.8125rem]"
            placeholder={"License Number, Pharmacy Name, Address, City, State, Zip, Email, Status"} />

          {columns.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c, i) => (
                <span key={`${c}-${i}`} className="badge tone-neutral font-mono normal-case">{c}</span>
              ))}
            </div>
          )}

          {duplicates.length > 0 && (
            <div className="t-small text-bad">
              Repeated column name{duplicates.length > 1 ? "s" : ""}:{" "}
              {[...new Set(duplicates)].join(", ")} — each column needs a distinct name.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <div>
            <h2 className="card-title">What each column means</h2>
            <p className="card-sub mt-0.5">
              Mapped automatically where the name is recognisable — check every one
            </p>
          </div>
          <span className="t-small text-muted">{mappedCount} of {fields.length} mapped</span>
        </div>

        <div className="p-3.5">
          {columns.length === 0 ? (
            <p className="t-small text-muted text-center py-6">
              Enter the file&apos;s columns above and they can be mapped here.
            </p>
          ) : (
            <div className="space-y-1">
              {fields.map((f) => {
                const value = valueFor(f.field);
                const missingRequired = f.required && !value;
                return (
                  <div key={f.field}
                    className={`grid sm:grid-cols-[220px_1fr] gap-2 sm:gap-4 items-start py-2
                      border-b border-line/50 last:border-0
                      ${missingRequired ? "bg-bad-container/30 -mx-2 px-2 rounded-lg" : ""}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="t-body font-medium">{f.label}</span>
                        {f.required && <span className="badge tone-bad">required</span>}
                        {f.importance === "important" && !f.required &&
                          <span className="badge tone-warn">advised</span>}
                      </div>
                      <p className="t-small text-muted mt-0.5 leading-snug">{f.help}</p>
                    </div>
                    <select name={`map_${f.field}`} value={value}
                      onChange={(e) => setOverrides((o) => ({ ...o, [f.field]: e.target.value }))}
                      className="inp w-full max-w-sm">
                      <option value="">— not in this file —</option>
                      {columns.map((c, i) => (
                        <option key={`${c}-${i}`} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {columns.length > 0 && (
          <div className="px-3.5 py-3 border-t border-line flex flex-wrap items-center gap-3">
            <span className={`badge ${emailChosen ? "tone-ok" : "tone-bad"}`}>
              <Icon name={emailChosen ? "check_circle" : "error"} size={13} />
              {emailChosen ? "Email column chosen" : "Email column missing"}
            </span>
            <span className={`badge ${nameChosen ? "tone-ok" : "tone-bad"}`}>
              <Icon name={nameChosen ? "check_circle" : "error"} size={13} />
              {nameChosen ? "Name column chosen" : "Name column missing"}
            </span>
            {!emailChosen && (
              <span className="t-small text-muted">
                Without an email column this file cannot be imported.
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
