import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { can, ROLE_LABEL, type Permission } from "@/lib/rbac";
import { Nav, type NavGroup } from "@/components/nav";
import { GlobalSearch } from "@/components/topbar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon, type IconName } from "@/components/icon";
import { crmHomePath } from "@/lib/showcase-links";
import { isCrmShowcase } from "@/lib/showcase-mode";
import { ReadonlyNotice } from "@/components/showcase/readonly-notice";
import { WorkspaceMenu } from "@/components/dashboard/workspace-menu";

export const dynamic = "force-dynamic";

/**
 * Nav is declared with the permission each entry needs, then filtered for the signed-in role.
 *
 * The order is the order the work happens in: bring data in, check it two ways, write to it,
 * hand it over. Sections that have several screens keep them as children rather than as more
 * top-level entries, because a twenty-item list is a list nobody reads.
 */
type Decl = {
  group: string;
  items: {
    href: string; label: string; icon: IconName; need: Permission;
    children?: { href: string; label: string; need: Permission }[];
  }[];
}[];

const NAV: Decl = [
  { group: "Work", items: [
    { href: "/", label: "Start here", icon: "speed", need: "registry.view" },
    { href: "/pharmacies", label: "Pharmacy records", icon: "storefront", need: "registry.view",
      children: [
        { href: "/pharmacies", label: "All records", need: "registry.view" },
        { href: "/pharmacies?verification=NEEDS_REVIEW", label: "Needs a decision",
          need: "registry.view" },
      ] },
    { href: "/data/import", label: "Import data", icon: "upload_file", need: "verification.manage",
      children: [
        { href: "/data/import/new", label: "Upload a file", need: "verification.manage" },
        { href: "/data/batches", label: "Past imports", need: "registry.view" },
        { href: "/data/rescreen", label: "Re-screen the registry", need: "verification.manage" },
      ] },
    { href: "/verification/email", label: "Check email addresses", icon: "mark_email_read",
      need: "verification.manage" },
    { href: "/verification/work", label: "Check the businesses", icon: "fact_check",
      need: "verification.manage",
      children: [
        { href: "/verification/work", label: "Verify the next record",
          need: "verification.manage" },
        { href: "/verification", label: "Round progress", need: "registry.view" },
      ] },
    { href: "/campaigns", label: "Campaigns", icon: "send", need: "campaign.view",
      children: [
        { href: "/campaigns", label: "All campaigns", need: "campaign.view" },
        { href: "/campaigns/new", label: "New campaign", need: "campaign.edit" },
      ] },
    { href: "/inbox", label: "Inbox", icon: "mail", need: "inbox.view" },
    { href: "/follow-ups", label: "Follow-ups", icon: "schedule", need: "followup.manage" },
    { href: "/deliverable", label: "Client file", icon: "fact_check", need: "registry.view" },
  ]},
  { group: "Admin", items: [
    { href: "/sender-health", label: "Sender health", icon: "monitor_heart",
      need: "campaign.view" },
    { href: "/settings", label: "Settings", icon: "settings", need: "settings.manage",
      children: [
        { href: "/settings/mailboxes", label: "Mailboxes", need: "mailbox.manage" },
        { href: "/settings/deliverability", label: "Deliverability", need: "mailbox.manage" },
        { href: "/settings/suppression", label: "Suppression list", need: "suppression.manage" },
        { href: "/settings/users", label: "Operators", need: "users.manage" },
      ] },
    { href: "/audit", label: "Audit log", icon: "history", need: "audit.view" },
  ]},
];

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const home = await crmHomePath();

  const theme = (await cookies()).get("theme")?.value;
  const themeMode = theme === "light" || theme === "dark" || theme === "system" ? theme : "light";

  const [unread, dueFollowUps, undecided] = await Promise.all([
    can(session.role, "inbox.view")
      ? prisma.conversation.count({ where: { unread: true } }) : 0,
    can(session.role, "followup.manage")
      ? prisma.followUp.count({
          where: { status: { in: ["PENDING", "DUE"] }, dueAt: { lte: new Date() } } })
      : 0,
    can(session.role, "registry.view")
      ? prisma.pharmacy.count({ where: { verificationStatus: "NEEDS_REVIEW" } }) : 0,
  ]);

  const badges: Record<string, number> = {
    "/inbox": unread,
    "/follow-ups": dueFollowUps,
    "/pharmacies?verification=NEEDS_REVIEW": undecided,
  };

  const groups: NavGroup[] = NAV
    .map((g) => ({
      group: isCrmShowcase() && g.group === "Work" ? "Workspace" : g.group,
      items: g.items.flatMap((i) => {
        const children = (i.children ?? [])
          .filter((c) => can(session.role, c.need))
          .map((c) => ({ href: c.href, label: c.label, badge: badges[c.href] }));

        // A role may be allowed a section's children but not its landing page - Mailboxes
        // without Settings, say. Rather than hide the lot, the first child it can reach
        // stands in for the parent, so nothing becomes unreachable by permission arithmetic.
        if (!can(session.role, i.need)) {
          const [head, ...rest] = children;
          if (!head) return [];
          return [{ href: head.href, label: head.label, icon: i.icon, badge: head.badge,
                    children: rest }];
        }
        return [{ href: i.href === "/" ? home : i.href, label: isCrmShowcase() && i.href === "/" ? "Dashboard" : i.label, icon: i.href === "/" ? "dashboard" : i.icon, badge: badges[i.href], children }];
      }),
    }))
    .filter((g) => g.items.length > 0);

  const live = config.emailMode === "gmail" && config.liveSendingEnabled;
  const initials = (session.name || session.email).trim().slice(0, 1).toUpperCase();

  return (
    <div className={isCrmShowcase() ? "min-h-screen crm-demo-compact" : "min-h-screen"}>
      {isCrmShowcase() && <ReadonlyNotice />}
      {/* Sending mode, across the top of every screen, so it is never a surprise. */}
      <div className={`crm-mode-banner fixed top-0 inset-x-0 z-50 h-banner flex items-center justify-between
        px-4 t-label ${live ? "bg-bad-container text-bad" : "bg-high text-ink"}`}>
        <span className="flex items-center gap-2 truncate">
          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-bad" : "bg-accent"} animate-pulse`} />
          {isCrmShowcase()
            ? "expressdiabetics CRM"
            : config.emailMode !== "gmail"
            ? "Demo email mode — outbound is simulated, nothing can leave the application"
            : live
              ? "Live sending is ON — real email will be delivered to allowlisted addresses"
              : "Gmail mode, sending disabled — both switches must be on to send"}
        </span>
        <span className="hidden md:flex items-center gap-1.5 text-muted">
          <Icon name="shield" size={14} />
          {isCrmShowcase() ? "Demo" : config.emailMode === "gmail" ? "Gmail gateway" : "Mock gateway"}
        </span>
      </div>

      {/* Sidebar */}
      <aside id="crm-sidebar" aria-label="Workspace navigation" className="crm-sidebar fixed left-0 top-banner bottom-0 w-sidebar z-40 bg-sidebar
        text-sidebar-ink flex flex-col border-r border-white/[0.06]">
        <div className="px-4 py-3.5">
          <Link href={home} className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-accent text-accent-ink flex items-center
              justify-center shrink-0">
              <Icon name="verified_user" size={19} />
            </span>
            <span className="min-w-0">
              <span className="block t-title text-sidebar-ink leading-tight truncate">
                {isCrmShowcase() ? "expressdiabetics" : "Verified Pharmacy"}
              </span>
              <span className="block text-[0.6875rem] text-sidebar-muted leading-tight">
                {isCrmShowcase() ? "Pharmacy workspace" : "Outreach CRM"}
              </span>
            </span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Nav groups={groups} />
        </div>

        <div className="px-4 py-3 border-t border-white/10 space-y-2.5">
          <ThemeToggle initial={themeMode} />
          <div className="flex items-center gap-2.5">
            <Link href="/account"
              className="w-8 h-8 rounded-full bg-accent text-accent-ink flex items-center
                justify-center shrink-0 text-[0.8125rem] font-semibold">
              {initials}
            </Link>
            <Link href="/account" className="min-w-0 flex-1 group">
              <span className="block t-small font-semibold text-sidebar-ink truncate
                group-hover:text-accent-soft transition-colors">
                {session.name || session.email}
              </span>
              <span className="block text-[0.6875rem] text-sidebar-muted truncate">
                {ROLE_LABEL[session.role]}
              </span>
            </Link>
            <form action="/api/auth/logout" method="post">
              <button className="text-sidebar-muted hover:text-bad transition-colors p-1"
                title="Sign out" aria-label="Sign out">
                <Icon name="logout" size={18} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Header + content */}
      <div className="crm-shell pl-sidebar pt-banner">
        <header className="crm-topbar fixed top-banner left-sidebar right-0 h-header z-30 bg-panel/90
          backdrop-blur-xl border-b border-line flex items-center justify-between gap-4 px-5">
          {isCrmShowcase() && <WorkspaceMenu />}
          <GlobalSearch />
          <div className="flex items-center gap-3 shrink-0">
            {isCrmShowcase() && <><span className="crm-demo-badge"><span />Demo workspace</span><Link href="/inbox" aria-label={`Inbox, ${unread} unread conversations`} className="crm-inbox-link"><Icon name="notifications_active" size={19} />{unread > 0 && <span />}</Link></>}
            <span className="crm-demo-guide hidden lg:flex items-center gap-2 bg-raised border border-line
              rounded-lg px-2.5 py-1">
              <span className="t-label text-muted">Mode</span>
              <span className={`badge ${live ? "tone-bad" : "tone-accent"}`}>
                {isCrmShowcase() ? "Demo" : config.emailMode === "gmail" ? (live ? "Live" : "Gmail · off") : "Sandbox"}
              </span>
            </span>
            <Link href="/account" className="w-8 h-8 rounded-full bg-accent/12 text-accent
              flex items-center justify-center hover:bg-accent/20 transition-colors"
              title="Your account">
              <Icon name="person" size={18} />
            </Link>
          </div>
        </header>

        <main className="crm-main pt-header min-h-[calc(100vh-1.75rem)]">
          <div className="crm-content px-6 py-5 max-w-[1600px] space-y-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
