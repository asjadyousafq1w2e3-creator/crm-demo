import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth";
import { previewScope, verificationOptions } from "@/lib/verify/service";
import { createBatch } from "@/lib/verify/actions";
import { config } from "@/lib/config";
import { Badge, Card, Empty, Note, PageHeader, Row, Stat } from "@/components/ui";
import { HBars } from "@/components/charts";
import { Icon } from "@/components/icon";
import { StageBar } from "@/components/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email verification" };

const PREVIOUS_RESULTS = [
  { value: "UNKNOWN", label: "unknown", why: "worth a second look — often resolves on a retry" },
  { value: "RISKY", label: "risky", why: "re-check before writing them off" },
  { value: "CATCH_ALL", label: "catch-all", why: "a domain may have stopped accepting everything" },
  { value: "VALID", label: "valid", why: "confirm before a big send" },
  { value: "INVALID", label: "invalid", why: "rarely worth paying for twice" },
];

/**
 * Email verification.
 *
 * Verification is charged per address, so the whole screen is built around deciding what to spend
 * on before spending it: a scope, a live count of exactly what it covers, and the account balance
 * next to it.
 */
export default async function EmailVerification({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePagePermission("verification.manage");
  const { error } = await searchParams;

  const [batches, overall, unchecked, options] = await Promise.all([
    prisma.emailVerificationBatch.findMany({ orderBy: { id: "desc" }, take: 20 }),
    prisma.pharmacy.groupBy({ by: ["emailVerificationStatus"],
                              where: { email: { not: null } }, _count: true }),
    previewScope({ onlyUnchecked: true }),
    verificationOptions(),
  ]);

  const n = (s: string) => overall.find((o) => o.emailVerificationStatus === s)?._count ?? 0;
  const withEmail = overall.reduce((a, o) => a + o._count, 0);
  const configured = Boolean(config.verifier.apiKey);

  // The provider's own balance, asked for only when a key exists.
  let balance: { apiStatus: string; dailyCredits: number; instantCredits: number } | null = null;
  let balanceError: string | null = null;
  if (configured) {
    try {
      balance = await (await import("@/lib/verify/reoon")).getBalance();
    } catch (e) {
      balanceError = (e as Error).message;
    }
  }

  const openRounds = batches.filter((b) =>
    ["PENDING", "SUBMITTED", "EXPORTED"].includes(b.status));

  return (
    <>
      <PageHeader title="Email verification"
        subtitle="Check deliverability before sending anything. Only a valid address ever becomes campaign-eligible — catch-all and risky results are recorded honestly and kept apart."
        actions={
          <span className={`badge ${configured ? "tone-ok" : "tone-warn"}`}>
            <Icon name={configured ? "check_circle" : "warning"} size={13} />
            {configured ? "Reoon connected" : "No verifier key"}
          </span>
        } />
      <StageBar stage="email" />

      {error && <Note tone="bad">{error}</Note>}

      {!configured && (
        <Note tone="warn">
          <strong>No verifier is configured.</strong> Put your key in{" "}
          <code>web/.env</code> as <code>REOON_API_KEY=&quot;your-key&quot;</code> and restart the
          server; rounds are then submitted and collected automatically. Without it a round still
          works as a file exchange: export the CSV, run it through any verifier, paste the
          results back.
        </Note>
      )}

      {/* ------------------------------------------------------------------ where things stand */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <Stat label="Addresses held" value={withEmail} icon={<Icon name="mail" size={18} />} />
        <Stat label="Never checked" value={n("NOT_CHECKED")}
          tone={n("NOT_CHECKED") ? "warn" : undefined} />
        <Stat label="With the verifier" value={n("IN_PROGRESS")}
          tone={n("IN_PROGRESS") ? "info" : undefined} />
        <Stat label="Valid" value={n("VALID")} tone={n("VALID") ? "ok" : undefined}
          hint="the only status that can be mailed" />
        <Stat label="Invalid" value={n("INVALID")} tone={n("INVALID") ? "bad" : undefined} />
        <Stat label="Catch-all or risky" value={n("CATCH_ALL") + n("RISKY") + n("UNKNOWN")}
          hint="accepted by the domain, unproven" />
      </div>

      {openRounds.length > 0 && (
        <Note tone="info">
          {openRounds.length} round{openRounds.length > 1 ? "s are" : " is"} still open:{" "}
          {openRounds.map((b, i) => (
            <span key={b.id}>
              {i > 0 && ", "}
              <Link href={`/verification/email/${b.id}`} className="link">{b.name}</Link>
              {b.providerStatus ? ` (${b.providerStatus})` : ""}
            </span>
          ))}
          . Addresses in an open round are held out of circulation so the same one is never paid
          for twice.
        </Note>
      )}

      {n("NOT_CHECKED") === withEmail && withEmail > 0 && (
        <Note tone="warn">
          <strong>Nothing has been verified yet.</strong> All {withEmail.toLocaleString()} addresses
          are unchecked, which is why no campaign has an eligible recipient. Expect 15–30% of a
          never-verified list to fail; sending to it first would burn the sending domain for months.
        </Note>
      )}

      {/* ------------------------------------------------------------------ build a round */}
      <div className="grid xl:grid-cols-[1fr_360px] gap-4 items-start">
        <Card title="Start a verification round"
          subtitle="Pick exactly what to spend on — a state at a time is the usual way">
          <form action={createBatch} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block t-small text-muted mb-1">Round name</span>
                <input name="name" className="input" placeholder="e.g. Florida, first pass"
                  maxLength={25} />
                <span className="block t-small text-muted mt-1">
                  Reoon caps task names at 25 characters.
                </span>
              </label>
              <label className="block">
                <span className="block t-small text-muted mb-1">
                  Cap <span className="text-muted">· optional, for a trial run</span>
                </span>
                <input name="limit" type="number" min={1} max={50000} className="input"
                  placeholder="e.g. 500" />
              </label>
            </div>

            <fieldset>
              <legend className="t-small text-muted mb-1.5">
                States <span className="text-muted">· none selected means every state</span>
              </legend>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {options.states.map((s) => (
                  <label key={s.value}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1
                      cursor-pointer hover:border-accent/40 transition-colors">
                    <input type="checkbox" name="state" value={s.value} />
                    <span className="t-small font-medium">{s.value}</span>
                    <span className="t-small text-muted ml-auto tabular-nums">{s.count}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid sm:grid-cols-2 gap-4">
              <fieldset>
                <legend className="t-small text-muted mb-1.5">Address kind</legend>
                <div className="flex flex-wrap gap-1.5">
                  {options.kinds.map((k) => (
                    <label key={k.value}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1
                        cursor-pointer hover:border-accent/40 transition-colors">
                      <input type="checkbox" name="emailKind" value={k.value} />
                      <span className="t-small">
                        {k.value === "PERSONAL" ? "named person"
                          : k.value === "SHARED" ? "shared inbox" : k.value.toLowerCase()}
                      </span>
                      <span className="t-small text-muted tabular-nums">{k.count}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="t-small text-muted mb-1.5">Pharmacy type</legend>
                <div className="flex flex-wrap gap-1.5">
                  {options.types.slice(0, 6).map((t) => (
                    <label key={t.value}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1
                        cursor-pointer hover:border-accent/40 transition-colors">
                      <input type="checkbox" name="pharmacyType" value={t.value} />
                      <span className="t-small">{t.value.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="t-small text-muted tabular-nums">{t.count}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <fieldset className="rounded-lg border border-line p-3">
              <legend className="t-small text-muted px-1">What to check</legend>
              <label className="flex items-start gap-2 t-small">
                <input type="checkbox" name="onlyUnchecked" defaultChecked className="mt-0.5" />
                <span>
                  Addresses never checked
                  <span className="block text-muted">
                    The default, and the safe one. Clearing this on its own changes nothing —
                    to re-check, name a previous result or set a staleness window below.
                  </span>
                </span>
              </label>

              <div className="mt-2.5 pt-2.5 hairline">
                <div className="t-small text-muted mb-1.5">
                  Also re-check these previous results
                </div>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {PREVIOUS_RESULTS.map((r) => (
                    <label key={r.value}
                      className="flex items-start gap-2 rounded-lg border border-line px-2 py-1.5
                        cursor-pointer hover:border-accent/40 transition-colors">
                      <input type="checkbox" name="previousResult" value={r.value} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="t-small font-medium">{r.label}</span>
                        <span className="block text-[0.6875rem] text-muted leading-snug">{r.why}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="block mt-2.5 pt-2.5 hairline">
                <span className="block t-small text-muted mb-1">
                  Re-check anything last checked more than this many days ago
                </span>
                <input name="recheckOlderThanDays" type="number" min={1} className="inp w-32"
                  placeholder="e.g. 180" />
                <span className="block t-small text-muted mt-1">
                  A verification is a snapshot. Staff leave and domains lapse; a year-old
                  &ldquo;valid&rdquo; is a guess.
                </span>
              </label>
            </fieldset>

            <fieldset className="rounded-lg border border-line p-3">
              <legend className="t-small text-muted px-1">Narrow it further</legend>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block t-small text-muted mb-1">Added in the last N days</span>
                  <input name="addedWithinDays" type="number" min={1} className="inp w-full"
                    placeholder="e.g. 7 — verify a fresh import on its own" />
                </label>
                <label className="block">
                  <span className="block t-small text-muted mb-1">From one import batch</span>
                  <select name="importBatchId" className="inp w-full" defaultValue="">
                    <option value="">Any batch</option>
                    {options.batches.map((b) => (
                      <option key={b.id} value={b.id}>#{b.id} {b.label.slice(0, 34)}</option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="block t-small text-muted mb-1">Name, city or address contains</span>
                  <input name="search" className="inp w-full" placeholder="optional" />
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mt-2.5">
                <label className="flex items-start gap-2 t-small">
                  <input type="checkbox" name="onlyVerifiedRecords" className="mt-0.5" />
                  <span>
                    Only business-verified records
                    <span className="block text-muted">
                      Spend on the ones that could actually be mailed.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 t-small">
                  <input type="checkbox" name="excludeContacted" className="mt-0.5" />
                  <span>
                    Only never-contacted
                    <span className="block text-muted">Skip anyone a campaign already wrote to.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {configured && (
              <label className="flex items-start gap-2 t-small">
                <input type="checkbox" name="submitNow" defaultChecked className="mt-0.5" />
                <span>
                  Send it to Reoon straight away
                  <span className="block text-muted">
                    Otherwise the round is created and waits, and you can still export it as a file.
                  </span>
                </span>
              </label>
            )}

            <button className="btn btn-primary">
              <Icon name="fact_check" size={16} /> Create the round
            </button>
          </form>
        </Card>

        {/* ---------------------------------------------------------- balance and pool */}
        <div className="space-y-4">
          {configured && (
            <Card title="Reoon account"
              subtitle={balance ? `API ${balance.apiStatus}` : "could not be read"}>
              {balanceError ? (
                <Note tone="bad">{balanceError}</Note>
              ) : balance ? (
                <>
                  <Row label="Daily credits left" value={balance.dailyCredits.toLocaleString()} />
                  <Row label="Instant credits left" value={balance.instantCredits.toLocaleString()} />
                  <div className="mt-3 pt-3 hairline">
                    {unchecked.total > balance.dailyCredits + balance.instantCredits ? (
                      <p className="t-small text-warn leading-relaxed">
                        {unchecked.total.toLocaleString()} addresses are unchecked but only{" "}
                        {(balance.dailyCredits + balance.instantCredits).toLocaleString()} credits
                        remain. Cap the round, or do it a state at a time.
                      </p>
                    ) : (
                      <p className="t-small text-muted leading-relaxed">
                        Enough credit to check all {unchecked.total.toLocaleString()} unchecked
                        addresses.
                      </p>
                    )}
                  </div>
                </>
              ) : null}
            </Card>
          )}

          <Card title="Unverified by state"
            subtitle="What is waiting, so you can decide where to start">
            <HBars data={unchecked.byState.slice(0, 12)
              .map((s) => ({ label: s.state, value: s.count }))}
              unit="addresses" empty="Every address has been checked." />
            {unchecked.duplicates > 0 && (
              <p className="t-small text-muted mt-3 pt-3 hairline">
                {unchecked.duplicates.toLocaleString()} of these are the same address on more than
                one record. Reoon charges once per distinct address and removes the rest.
              </p>
            )}
          </Card>

          <Card title="How a result is read" className="t-small text-muted">
            <ul className="space-y-1.5">
              <li>· <span className="text-ok font-medium">valid</span> — deliverable, and the only
                status a campaign can use.</li>
              <li>· <span className="text-muted font-medium">catch-all</span> — the domain accepts
                everything, so acceptance proves nothing about the mailbox.</li>
              <li>· <span className="text-warn font-medium">risky</span> — disposable or otherwise
                doubtful.</li>
              <li>· <span className="text-bad font-medium">invalid</span> — undeliverable, and
                suppressed so nothing writes to it again.</li>
              <li>· <span className="font-medium">unknown</span> — the verifier could not decide;
                left unchecked rather than guessed.</li>
              <li className="pt-1.5">A spamtrap is suppressed outright. One delivery to one can cost
                a sending domain its reputation for months.</li>
            </ul>
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------------------------ rounds */}
      <Card pad={false} title="Verification rounds" className="overflow-x-auto">
        {batches.length === 0 ? (
          <Empty>No verification round has been run yet.</Empty>
        ) : (
          <table className="tbl">
            <thead><tr>
              <th>Round</th><th>Status</th><th>Progress</th><th>Addresses</th>
              <th>Valid</th><th>Invalid</th><th>Catch-all / risky</th><th>Created</th>
            </tr></thead>
            <tbody>
              {batches.map((b) => {
                const scope = b.scope as { states?: string[]; limit?: number };
                const pct = b.total ? Math.round((b.checkedCount / b.total) * 100) : 0;
                return (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/verification/email/${b.id}`} className="link">{b.name}</Link>
                      <div className="t-small text-muted">
                        {scope.states?.length ? scope.states.join(", ") : "every state"}
                        {b.providerTaskId ? ` · task ${b.providerTaskId}` : " · file exchange"}
                      </div>
                    </td>
                    <td>
                      <Badge value={b.status} />
                      {b.error && <div className="t-small text-bad mt-0.5">error</div>}
                    </td>
                    <td className="min-w-[120px]">
                      {b.status === "APPLIED" ? (
                        <span className="t-small text-ok">done</span>
                      ) : b.providerTaskId ? (
                        <>
                          <div className="h-1.5 rounded-full bg-line/70 overflow-hidden">
                            <div className="h-full rounded-full bg-accent"
                              style={{ width: `${pct}%` }} />
                          </div>
                          <span className="t-small text-muted">
                            {b.providerStatus ?? "waiting"} · {pct}%
                          </span>
                        </>
                      ) : <span className="t-small text-muted">not sent</span>}
                    </td>
                    <td className="tabular-nums">{b.total.toLocaleString()}</td>
                    <td className="tabular-nums text-ok">{b.valid.toLocaleString()}</td>
                    <td className="tabular-nums text-bad">{b.invalid.toLocaleString()}</td>
                    <td className="tabular-nums text-muted">
                      {(b.catchAll + b.risky + b.unknown).toLocaleString()}
                    </td>
                    <td className="t-small text-muted tabular-nums whitespace-nowrap">
                      {b.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
