"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "./icon";

export type NavChild = { href: string; label: string; badge?: number };
export type NavItem = {
  href: string; label: string; icon: IconName; badge?: number; children?: NavChild[];
};
export type NavGroup = { group: string; items: NavItem[] };

/**
 * Sidebar links, two levels deep. The item list arrives already filtered by permission on the
 * server - this component only decides what is highlighted and what is unfolded.
 *
 * Children stay hidden until their section is the one being used. A flat list of every page at
 * once said nothing about which pages belong together or which order they run in; this way the
 * resting sidebar is short enough to read, and the depth appears where it is relevant.
 */
export function Nav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const params = useSearchParams();

  // Two entries can share a path and differ only by query string (All records vs Needs review),
  // so an entry with a query only matches when every one of its parameters is present.
  const queryMatches = (href: string) => {
    const q = href.split("?")[1];
    if (!q) return true;
    return [...new URLSearchParams(q)].every(([k, v]) => params.get(k) === v);
  };
  const pathMatches = (href: string) => {
    const path = href.split("?")[0];
    return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
  };
  const matches = (href: string) => pathMatches(href) && queryMatches(href);

  // Longest match wins, so /settings/users highlights Operators rather than also lighting up
  // Settings, whose path is a prefix of it. A filtered entry outranks its unfiltered sibling.
  const rank = (a: string, b: string) =>
    (b.includes("?") ? 1 : 0) - (a.includes("?") ? 1 : 0) || b.length - a.length;
  const best = groups
    .flatMap((g) => g.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]))
    .filter(matches).sort(rank)[0];

  // A section unfolds only when the winning entry belongs to it. Testing each href for a prefix
  // match instead would open Round progress (/verification) on /verification/email too.
  const open = (i: NavItem) =>
    i.href === best || (i.children ?? []).some((c) => c.href === best);

  return (
    <nav className="px-2.5 py-2 space-y-4">
      {groups.map((g) => (
        <div key={g.group}>
          <div className="nav-group">{g.group}</div>
          <div className="space-y-0.5">
            {g.items.map((n) => {
              const unfolded = open(n);
              return (
                <div key={n.href}>
                  <Link href={n.href} data-active={n.href === best} className="nav-link">
                    <Icon name={n.icon} size={20} />
                    <span className="flex-1 truncate">{n.label}</span>
                    <Badge value={n.badge} active={n.href === best} />
                  </Link>
                  {unfolded && n.children?.length ? (
                    <div className="mt-0.5 mb-1 ml-[1.65rem] pl-3 border-l border-white/10
                      space-y-px">
                      {n.children.map((c) => (
                        <Link key={c.href} href={c.href} data-active={c.href === best}
                          className="nav-sub">
                          <span className="flex-1 truncate">{c.label}</span>
                          <Badge value={c.badge} active={c.href === best} />
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Badge({ value, active }: { value?: number; active: boolean }) {
  if (!value) return null;
  return (
    <span className={`rounded-lg px-1.5 py-px text-[0.6875rem] font-semibold ${
      active ? "bg-black/20 text-sidebar-active-ink" : "bg-white/10 text-sidebar-ink"}`}>
      {value}
    </span>
  );
}
