import Link from "next/link";

/**
 * Status vocabulary. Tones are semantic (ok / warn / bad / info / neutral) rather than literal
 * colours, so the whole palette swaps with the theme instead of each badge hard-coding a shade
 * that only reads well on one background.
 */
const TONE: Record<string, string> = {
  // registry + verification
  READY_FOR_VERIFICATION: "tone-warn",
  IN_VERIFICATION: "tone-info",
  VERIFIED: "tone-ok",
  NEEDS_REVIEW: "tone-warn",
  EXCLUDED: "tone-bad",
  DATA_READY: "tone-neutral",
  NOT_STARTED: "tone-neutral",
  NOT_CHECKED: "tone-neutral",
  SOURCE_MISSING: "tone-warn",
  OK: "tone-ok",
  SKIPPED_NO_CHANGE: "tone-neutral",
  // campaigns
  DRAFT: "tone-neutral",
  READY: "tone-info",
  ACTIVE: "tone-ok",
  RUNNING: "tone-ok",
  PAUSED: "tone-warn",
  COMPLETED: "tone-info",
  CANCELLED: "tone-neutral",
  // mailboxes
  CONNECTED: "tone-ok",
  DISCONNECTED: "tone-neutral",
  WARNING: "tone-warn",
  ERROR: "tone-bad",
  HEALTHY: "tone-ok",
  UNHEALTHY: "tone-bad",
  UNKNOWN: "tone-neutral",
  // leads + recipients
  NOT_CONTACTED: "tone-neutral",
  QUEUED: "tone-info",
  SCHEDULED: "tone-info",
  SENDING: "tone-info",
  SENT: "tone-info",
  REPLIED: "tone-ok",
  INTERESTED: "tone-ok",
  NOT_INTERESTED: "tone-neutral",
  FOLLOW_UP: "tone-warn",
  BOUNCED: "tone-bad",
  FAILED: "tone-bad",
  BLOCKED: "tone-warn",
  UNSUBSCRIBED: "tone-bad",
  CLOSED: "tone-neutral",
  // users
  OWNER: "tone-accent",
  ADMIN: "tone-accent",
  MANAGER: "tone-info",
  AGENT: "tone-neutral",
  VIEWER: "tone-neutral",
  SUSPENDED: "tone-bad",
  PASS: "tone-ok",
  FAIL: "tone-bad",
  WARN: "tone-warn",
};

export const toneFor = (value: string) => TONE[value] ?? "tone-neutral";

export function Badge({ value, tone, title }:
  { value?: string | null; tone?: string; title?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <span className={`badge ${tone ?? toneFor(value)}`} title={title}>
      {value.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

// Tailwind only sees class names that appear literally in the source, so tone -> class maps are
// spelled out rather than interpolated.
const DOT: Record<string, string> = {
  "tone-ok": "bg-ok", "tone-warn": "bg-warn", "tone-bad": "bg-bad",
  "tone-info": "bg-info", "tone-accent": "bg-accent", "tone-neutral": "bg-neutral",
};
const TEXT: Record<string, string> = {
  ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info",
};

/** A coloured dot for dense rows where a full badge would be noise. */
export function Dot({ value }: { value: string }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full ${DOT[toneFor(value)]}`} aria-hidden />
  );
}

/**
 * The command bar at the top of every screen: a full-bleed white strip carrying the title, one
 * line of context, and the page's primary actions. Full-bleed is deliberate - it separates
 * "where you are and what you can do here" from the content below it.
 */
export function PageHeader({ title, subtitle, actions, children }: {
  title: string; subtitle?: React.ReactNode;
  actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="-mx-6 -mt-5 mb-1 px-6 py-4 bg-panel border-b border-line">
      <div className="flex flex-wrap items-start justify-between gap-3 max-w-[1600px]">
        <div className="min-w-0">
          <h1 className="t-head">{title}</h1>
          {subtitle && <p className="t-body text-muted mt-1 max-w-3xl">{subtitle}</p>}
          {children}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = "", pad = true }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode;
  children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-hd">
          <div className="min-w-0">
            {title && <h2 className="card-title truncate">{title}</h2>}
            {subtitle && <p className="card-sub mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-3.5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, href, icon }: {
  label: string; value: string | number; hint?: React.ReactNode;
  tone?: "ok" | "warn" | "bad" | "info"; href?: string; icon?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        {/* Two lines reserved so a wrapped label does not push this card's number out of line
            with its neighbours. */}
        <div className="t-label text-muted min-h-[1.75rem]">{label}</div>
        {icon && <span className="text-muted/70">{icon}</span>}
      </div>
      <div className={`kpi-value mt-1.5 ${tone ? TEXT[tone] : ""}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {hint && <div className="t-small text-muted mt-1 leading-snug">{hint}</div>}
    </>
  );
  const cls = "card px-4 py-3.5 block transition-all";
  return href
    ? <Link href={href} className={`${cls} hover:border-accent/40 hover:shadow-pop`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-[13px] text-muted max-w-md mx-auto leading-relaxed">{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function Note({ tone = "info", children }: {
  tone?: "ok" | "warn" | "bad" | "info" | "neutral"; children: React.ReactNode;
}) {
  const ring: Record<string, string> = {
    ok: "border-ok/30 bg-ok/[0.06]", warn: "border-warn/30 bg-warn/[0.06]",
    bad: "border-bad/30 bg-bad/[0.06]", info: "border-info/30 bg-info/[0.06]",
    neutral: "border-line bg-raised",
  };
  return (
    <div className={`rounded-card border px-3 py-2 text-[12px] leading-relaxed ${ring[tone]}`}>
      {children}
    </div>
  );
}

/** Definition row used across detail panels. */
export function Row({ label, value, hint }: {
  label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-line/50 last:border-0">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="text-[12px] text-right tabular-nums">
        {value}
        {hint && <span className="block text-[10px] text-muted">{hint}</span>}
      </span>
    </div>
  );
}

/** Server-side pagination. Preserves every existing filter in the querystring. */
export function Pager({ page, pages, total, params }:
  { page: number; pages: number; total: number; params: Record<string, string | undefined> }) {
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };
  if (pages <= 1) return <div className="text-[12px] text-muted px-1">{total.toLocaleString()} records</div>;
  const win = [page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="text-muted mr-1">{total.toLocaleString()} records</span>
      {page > 1 && <Link className="btn btn-sm" href={href(page - 1)}>← Prev</Link>}
      {!win.includes(1) && <Link className="btn btn-sm" href={href(1)}>1</Link>}
      {win[0] > 2 && <span className="text-muted px-1">…</span>}
      {win.map((p) => (
        <Link key={p} href={href(p)}
          className={`btn btn-sm ${p === page ? "btn-primary" : ""}`}>{p}</Link>
      ))}
      {win[win.length - 1] < pages - 1 && <span className="text-muted px-1">…</span>}
      {!win.includes(pages) && <Link className="btn btn-sm" href={href(pages)}>{pages}</Link>}
      {page < pages && <Link className="btn btn-sm" href={href(page + 1)}>Next →</Link>}
    </div>
  );
}
