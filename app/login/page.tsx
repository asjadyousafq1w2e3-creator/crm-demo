import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { ThemeToggle } from "@/components/theme-toggle";
import { cookies } from "next/headers";
import { crmHomePath } from "@/lib/showcase-links";
import { isCrmShowcase, SHOWCASE_EMAIL, SHOWCASE_PASSWORD } from "@/lib/showcase-mode";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const home = await crmHomePath();
  const showcase = isCrmShowcase();
  if (!showcase && await getSession()) redirect(home);
  const sp = await searchParams;
  const theme = (await cookies()).get("theme")?.value;
  const themeMode = theme === "light" || theme === "dark" ? theme : "system";

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: the sign-in form itself. */}
      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[360px]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-[15px] font-semibold tracking-tight">{showcase ? "expressdiabetics" : "Pharmacy Outreach"}</div>
              <div className="text-[12px] text-muted">Registry &amp; CRM</div>
            </div>
            <ThemeToggle initial={themeMode} />
          </div>

          <h1 className="text-[20px] font-semibold tracking-tight">Sign in</h1>
          <p className="text-[13px] text-muted mt-1 mb-5">
            {showcase ? "Explore the original CRM with fictional sample records. No account setup or database is needed." : "Access is per-operator. Ask an owner or admin if you need an account."}
          </p>

          {sp.error === "suspended" ? (
            <div className="rounded-lg border border-bad/30 bg-bad-container/50 px-3 py-2 mb-4
                            t-small text-bad">
              The system is temporarily unavailable for maintenance. Sign-in is paused for
              everyone; your account and your data are unaffected.
            </div>
          ) : sp.error === "throttled" ? (
            <div className="rounded-lg border border-warn/30 bg-warn-container/50 px-3 py-2 mb-4
                            t-small text-warn">
              Too many failed attempts. Sign-in from here is paused for a few minutes — this
              applies per account and per address, and every attempt is recorded in the audit log.
            </div>
          ) : sp.error ? (
            <div className="rounded-lg border border-bad/30 bg-bad-container/50 px-3 py-2 mb-4
                            t-small text-bad">
              That email and password combination was not accepted.
            </div>
          ) : null}

          <form action="/api/auth/login" method="POST" className="space-y-3">
            <input type="hidden" name="next" value={sp.next ?? home} />
            <label className="block">
              <span className="block text-[12px] text-muted mb-1">Email</span>
              <input name="email" type="email" required autoFocus autoComplete="username"
                className="input" placeholder="you@example.com" defaultValue={showcase ? SHOWCASE_EMAIL : undefined} />
            </label>
            <label className="block">
              <span className="block text-[12px] text-muted mb-1">Password</span>
              <input name="password" type="password" required autoComplete="current-password"
                className="input" defaultValue={showcase ? SHOWCASE_PASSWORD : undefined} />
            </label>
            <button className="btn btn-primary w-full" type="submit">Sign in</button>
          </form>

          <p className="text-[11px] text-muted mt-5 leading-relaxed">
            {showcase ? <>Public demo: <code>{SHOWCASE_EMAIL}</code> / <code>{SHOWCASE_PASSWORD}</code>. Display only — nothing is saved or sent.</> : <>Passwords are stored only as a scrypt hash — never in readable form. Sessions expire after 12 hours, and a suspended account stops working on its next request.</>}
          </p>
        </div>
      </div>

      {/* Right: what this system is, and the one thing it will not do. */}
      <div className="hidden lg:flex flex-col justify-center gap-5 px-12 py-10 bg-panel
                      border-l border-line">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">
            A registry first, an outreach tool second.
          </h2>
          <p className="text-[13px] text-muted mt-2 leading-relaxed max-w-md">
            Every pharmacy here came from a state licensing board, carries per-field provenance
            back to its source, and keeps its own change history. Nothing in this application
            invents a record, a status, or a metric.
          </p>
        </div>

        <ul className="space-y-2.5 text-[12px] max-w-md">
          {[
            ["Verification is earned, not assumed", "A record becomes eligible for outreach only after a human confirms its licence, ownership and operating status."],
            ["Sending is gated twice", "Real email requires two separate switches plus an allowlist. The default is off."],
            ["No invented metrics", "There is no open rate and no delivery confirmation, because nothing here measures them."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              <span><span className="font-medium text-ink">{t}.</span>{" "}
                <span className="text-muted">{d}</span></span>
            </li>
          ))}
        </ul>

        <div className="text-[11px] text-muted pt-4 hairline">
          Email mode: <code className="text-ink">{config.emailMode}</code> · live sending{" "}
          <code className="text-ink">{String(config.liveSendingEnabled)}</code>
        </div>
      </div>
    </div>
  );
}
