# expressdiabetics dashboard improvements

Updated: 16 October 2026

The `/crm` demo dashboard now presents the original pharmacy registry in a redesigned
workspace. The original CRM routes, permission checks and pharmacy records are retained.

## Visual design

1. Replaced the crowded dashboard with a clear overview: headline metrics, activity,
   priorities, coverage, verification, geography, pharmacy records and recent events.
2. Introduced a neutral light canvas, white panels, subtle borders and a deep green sidebar
   that matches the expressdiabetics brand. Light mode remains the default.
3. Refined Inter typography with larger metric values, consistent heading sizes, tabular
   numbers, quieter labels and more deliberate spacing.
4. Standardized dashboard panel corners, padding, links, icon containers and button styles.
5. Replaced the generic greeting heading with **Dashboard**, a short personalized welcome,
   and clear **View pharmacies** and **New campaign** actions.
6. Renamed **Start here** to **Dashboard** and **Work** to **Workspace** in the demo sidebar.
7. Removed the duplicate fixed demo banner. A compact **Demo workspace** indicator now
   sits in the header alongside an inbox shortcut and account access.

## Dashboard content and interactions

8. Added four linked headline cards: total pharmacies, available email addresses, verified
   pharmacies and active campaigns. Figures come from the existing CRM queries.
9. Built a new activity chart with **7, 14 and 30 day** controls, date labels, gridlines,
   event totals and individual day tooltips available by hover, focus or touch.
10. Corrected demo audit aggregation to count the sample audit records themselves. The
    activity chart and recent-event list now use the same events, ordered by timestamp.
    The underlying sample events are illustrative; pharmacy data remains original.
11. Added a concise priorities panel linking to unread conversations, open follow-ups,
    verification tasks and sender health.
12. Reworked contact coverage into readable email, phone, website and owner/pharmacist
    progress bars. Phone coverage displays **99.9%**, preserving the missing record.
13. Replaced the old verification graphic with a compact ring, explicit status counts
    and a direct queue link. Unverified records retain their original status.
14. Replaced the overcrowded state chart with the five largest state groups, sorted by
    actual pharmacy count. Full state names and clickable filters make it easier to explore.
15. Added a five-record preview of the original pharmacy registry with names, locations,
    contact availability, verification status and links to full profiles.
16. Rebuilt recent activity as a compact timeline and added a latest-import summary.
17. Consolidated outreach details into a short summary of provider acceptance, replies
    and remaining capacity. No revenue, orders, growth rates or verified results are invented.

## Responsive layout and accessibility

18. Added responsive layouts for desktop, tablet and mobile. The pharmacy table scrolls
    within its panel, and dashboard sections stack on narrow screens.
19. Added mobile navigation with a menu button, dismissible backdrop, close button,
    Escape handling, focus management and body-scroll locking. Closed navigation is inert
    on mobile so hidden links cannot receive keyboard focus.
20. Added an accessible label to global pharmacy search, descriptive chart controls,
    screen-reader contact labels, visible keyboard focus and reduced-motion handling.
21. Kept light, dark and system theme controls. Dashboard colours follow the selected theme.

## Scope and original behavior

- All **974 original pharmacies**, **2,316 business contacts** and **974 recorded identifiers**
  remain in the approved static snapshot, including available addresses and notes.
- Existing pharmacy search, filters, profile pages, CSV export and demo login remain available.
- Extra onboarding guides remain hidden. The dashboard uses short labels and useful metrics.
- This remains a display-only demo. Live sending, imports, external connections and saved
  changes remain disabled. It requires no database or secrets on Vercel.
- The new dashboard and workspace styling apply to demo mode. The operational CRM retains
  its existing dashboard behind its explicit showcase-mode opt-out.
- No additional runtime libraries, chart packages, font services or backend dependencies
  were introduced.

## Main implementation files

Paths below are relative to the deployment repository root. In the original workspace they
are under `web/`.

| File | Change |
| --- | --- |
| `app/(crm)/page.tsx` | Existing metrics feed the new demo dashboard; 30-day activity window |
| `components/dashboard/overview.tsx` | Dashboard panels, metrics, record preview and links |
| `components/dashboard/activity-chart.tsx` | Interactive activity chart and date-range controls |
| `components/dashboard/dashboard.module.css` | Scoped responsive dashboard design |
| `components/dashboard/workspace-menu.tsx` | Accessible mobile navigation |
| `app/(crm)/layout.tsx` | Updated demo workspace header and navigation |
| `app/globals.css` | Demo-only palette, workspace chrome and mobile layout |
| `components/topbar.tsx` | Accessible global search label |
| `lib/showcase-db.ts` | Audit totals derived from the sample audit records |

## Validation

- **Production build: passed.** Node.js 22, `VERCEL=1`, showcase mode enabled;
  Prisma generation, optimized Next.js build, lint and TypeScript checks completed without
  warnings or errors. No database connection is required.
- **Dashboard browser checks: passed.** Metrics, date filters, daily tooltips, state ranking,
  pharmacy links, primary actions, mobile navigation, focus management and theme switching.
- **Responsive checks: passed.** Viewport widths of 320, 390, 768, 1024, 1280, 1440 and
  1920 pixels; no horizontal page overflow. Wide tables scroll within their own panel.
- **CRM regression checks: passed.** All 29 tested routes returned successfully; original
  pharmacy search, filtering, pagination, profiles, CSV export and demo sign-in still work.
- **Data integrity: passed.** Every approved pharmacy field, contact and identifier matches
  the static snapshot, including original statuses and date values. Audit aggregation matches
  the underlying sample events and respects its date filter.
- **Display-only behavior: passed.** Writes remain disabled, forms do not save, and chart
  controls issue no write requests. No browser console or React hydration errors remain.
- **Project knowledge graph: updated** with `graphify update .`.

The repository also runs a clean Ubuntu/Node.js 22 production-build workflow on every push:
[Production build](https://github.com/asjadyousafq1w2e3-creator/crm-demo/actions/workflows/build.yml).
