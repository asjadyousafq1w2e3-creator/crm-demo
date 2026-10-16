import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { config } from "@/lib/config";
import { systemState } from "@/lib/system-state";
import { suspend, resume } from "@/lib/platform-actions";
import { prisma } from "@/lib/db";
import { Card, Note, PageHeader, Row, Stat } from "@/components/ui";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintenance", robots: { index: false, follow: false } };

/**
 * Maintenance console.
 *
 * Reachable only at the path named by PLATFORM_CONSOLE_PATH, and linked from nowhere. The unlisted
 * path keeps it out of an operator's way; the permission check is what actually protects it, so
 * finding the URL gains nothing. Any other single-segment path 404s exactly as an unknown route
 * would, which is why this is a dynamic segment rather than a fixed one.
 */
export default async function PlatformConsole({ params, searchParams }: {
  params: Promise<{ platformConsole: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { platformConsole } = await params;
  // Wrong path: behave exactly like a route that does not exist, before any auth work happens.
  if (platformConsole !== config.platform.consolePath) notFound();

  await requirePagePermission("system.control");
  const { done } = await searchParams;
  const state = await systemState();

  const [operators, running, queued, mailboxes] = await Promise.all([
    prisma.appUser.count({ where: { role: { notIn: ["PLATFORM"] } } }),
    prisma.campaign.count({ where: { status: "RUNNING" } }),
    prisma.campaignRecipient.count({ where: { status: { in: ["QUEUED", "SCHEDULED"] } } }),
    prisma.mailbox.count({ where: { status: "CONNECTED" } }),
  ]);

  return (
    <>
      <PageHeader title="Maintenance"
        subtitle="Break-glass control over the application as a whole. Not linked from anywhere, and not reachable by any operator role." />

      {done === "suspended" && <Note tone="bad">The application is now suspended.</Note>}
      {done === "resumed" && <Note tone="ok">The application is running again.</Note>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Stat label="Status" value={state.suspended ? "Suspended" : "Running"}
          tone={state.suspended ? "bad" : "ok"}
          icon={<Icon name={state.suspended ? "block" : "check_circle"} size={18} />}
          hint={state.since && state.suspended
            ? `since ${state.since.toISOString().slice(0, 16).replace("T", " ")}`
            : undefined} />
        <Stat label="Operator accounts" value={operators} />
        <Stat label="Running campaigns" value={running} />
        <Stat label="Queued recipients" value={queued} hint={`${mailboxes} mailbox(es) connected`} />
      </div>

      {state.suspended ? (
        <Card title="Resume the application"
          subtitle="Operators can sign in again and the worker picks up where it left off">
          <div className="space-y-3">
            {state.reason && <Row label="Reason given" value={state.reason} />}
            <p data-ui="description" className="t-small text-muted leading-relaxed">
              Nothing was lost while suspended. Queued recipients stayed queued, claimed sends were
              returned to the queue by the usual recovery, and no message left the application.
            </p>
            <form action={resume}>
              <button className="btn btn-primary">
                <Icon name="play_arrow" size={16} /> Resume the application
              </button>
            </form>
          </div>
        </Card>
      ) : (
        <Card title="Suspend the application" className="border-bad/25"
          subtitle="A full stop: no sign-ins, no live sessions, no sending and no inbox sync">
          <form action={suspend} className="space-y-3">
            <label className="block">
              <span className="block t-small text-muted mb-1">
                Reason — recorded in the audit log
              </span>
              <input name="reason" required className="input"
                placeholder="e.g. billing on hold, or investigating a deliverability problem" />
            </label>
            <p data-ui="description" className="t-small text-muted leading-relaxed">
              Every operator, including owners, is signed out and cannot sign back in. The worker
              stops sending and syncing on its next tick. Messages already handed to the provider
              cannot be recalled — everything still queued simply stays queued.
            </p>
            <button className="btn btn-danger">
              <Icon name="pause" size={16} /> Suspend the application
            </button>
          </form>
        </Card>
      )}

      <Card title="How this account works" className="t-small text-muted">
        <div className="space-y-1.5">
          <div>· Provisioned from the environment on every sign-in, so rotating the key takes
            effect immediately and deleting the row by hand cannot lock you out.</div>
          <div>· Excluded from the operator list, from every role dropdown and from the permission
            matrix. No operator can rename, demote, suspend, reset or remove it.</div>
          <div>· Its actions are audited as <code className="text-ink">platform</code> rather than
            by address — the trail is complete without putting your identity in a log your
            operators read.</div>
          <div>· <code className="text-ink">system.control</code> is held by this role alone. An
            owner who found this path gets a 403.</div>
        </div>
      </Card>
    </>
  );
}
