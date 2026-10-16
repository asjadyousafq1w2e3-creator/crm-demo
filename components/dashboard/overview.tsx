import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { ActivityChart } from "./activity-chart";
import styles from "./dashboard.module.css";

type PharmacyPreview = { id: number; canonicalName: string; city: string | null; state: string | null; email: string | null; phone: string | null; verificationStatus: string };
export type DashboardOverviewProps = {
  name: string; total: number; withEmail: number; withPhone: number; withWebsite: number;
  withOwner: number; verified: number; ready: number; inVerification: number; needsReview: number;
  excluded: number; eligible: number; stateCount: number; tasks: number;
  campaigns: number; accepted: number; replies: number; unread: number; followUps: number;
  capacity: number; connected: number; showOutreach: boolean; canCreateCampaign: boolean;
  byState: { state: string; count: number }[];
  activity: { day: string; n: number }[];
  recent: { id: number; eventType: string; actor: string | null; createdAt: Date }[];
  pharmacies: PharmacyPreview[];
  batch: { label: string; recordsAccepted: number; completedAt: Date | null } | null;
};

const number = (value: number) => value.toLocaleString("en-US");
const percentage = (value: number, total: number) => total ? (value / total) * 100 : 0;
const date = (value: Date) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(value);
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function Panel({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`${styles.panel} ${className}`}>
    <div className={styles.panelHeading}><h2>{title}</h2>{action}</div>
    {children}
  </section>;
}

function Metric({ label, value, detail, icon, href, children }: { label: string; value: number; detail: string; icon: IconName; href: string; children?: React.ReactNode }) {
  return <Link href={href} className={styles.metric}>
    <div className={styles.metricHeading}><span>{label}</span><span className={styles.metricIcon}><Icon name={icon} size={18} /></span></div>
    <div className={styles.metricValue}>{number(value)}{children}</div>
    <div className={styles.metricDetail}>{detail}<Icon name="chevron_right" size={15} /></div>
  </Link>;
}

const EVENT_LABELS: Record<string, { label: string; icon: IconName }> = {
  IMPORT_COMPLETED: { label: "Pharmacy registry imported", icon: "upload_file" },
  VERIFICATION_RECORDED: { label: "Verification updated", icon: "verified" },
  CAMPAIGN_CREATED: { label: "Campaign created", icon: "campaign" },
  FOLLOW_UP_CREATED: { label: "Follow-up scheduled", icon: "schedule" },
};

export function DashboardOverview(p: DashboardOverviewProps) {
  const verification = [
    { label: "Awaiting verification", value: p.ready, color: "var(--dash-teal)" },
    { label: "In progress", value: p.inVerification, color: "rgb(var(--info))" },
    { label: "Verified", value: p.verified, color: "rgb(var(--ok))" },
    { label: "Needs review", value: p.needsReview, color: "rgb(var(--warn))" },
    { label: "Excluded", value: p.excluded, color: "rgb(var(--bad))" },
  ];
  let offset = 0;
  const circumference = 2 * Math.PI * 49;
  const topState = Math.max(...p.byState.map(state => state.count), 1);
  return <div className={styles.dashboard}>
    <header className={styles.pageHeading}>
      <div><div className={styles.eyebrow}>YOUR WORKSPACE, AT A GLANCE</div><h1>Dashboard<span className={styles.titleDot} /></h1><p>Welcome back, {p.name.split(" ")[0]}.</p></div>
      <div className={styles.headingActions}>
        <Link href="/pharmacies" className={styles.secondaryButton}><Icon name="storefront" size={17} />View pharmacies</Link>
        {p.canCreateCampaign && <Link href="/campaigns/new" className={styles.primaryButton}><Icon name="add" size={18} />New campaign</Link>}
      </div>
    </header>

    <div className={styles.metrics} aria-label="Workspace metrics">
      <Metric label="Total pharmacies" value={p.total} detail={`Across ${number(p.stateCount)} states`} icon="storefront" href="/pharmacies" />
      <Metric label="Email addresses" value={p.withEmail} detail={`${percentage(p.withEmail, p.total).toFixed(0)}% of pharmacy records`} icon="alternate_email" href="/pharmacies?hasEmail=yes"><span className={styles.metricTag}>Contact coverage</span></Metric>
      <Metric label="Verified pharmacies" value={p.verified} detail={`${number(p.ready)} awaiting verification`} icon="verified_user" href="/verification" />
      {p.showOutreach
        ? <Metric label="Active campaigns" value={p.campaigns} detail={`${number(p.replies)} replies received`} icon="campaign" href="/campaigns" />
        : <Metric label="States covered" value={p.stateCount} detail="Explore the pharmacy network" icon="groups" href="/pharmacies" />}
    </div>

    <div className={styles.activityRow}>
      <ActivityChart activity={p.activity} />
      <Panel title="Your priorities" action={<span className={styles.quietLabel}>WORKSPACE</span>} className={styles.priorities}>
        <div className={styles.priorityList}>
          {p.showOutreach && <>
            <Priority href="/inbox" icon="mail" label="Unread conversations" value={p.unread} tone="blue" />
            <Priority href="/follow-ups" icon="schedule" label="Open follow-ups" value={p.followUps} tone="amber" />
          </>}
          <Priority href="/verification/work" icon="fact_check" label="Verification tasks" value={p.tasks} tone="teal" />
        </div>
        {p.showOutreach && <Link href="/sender-health" className={styles.senderSummary}>
          <span className={styles.statusDot} /><span>{p.connected} connected mailboxes</span><Icon name="chevron_right" size={16} />
        </Link>}
        <div className={styles.priorityFooter}><Icon name="shield" size={16} /><span>{number(p.eligible)} campaign-eligible pharmacies</span></div>
      </Panel>
    </div>

    <div className={styles.insightsRow}>
      <Panel title="Contact coverage" action={<Icon name="group" size={18} className="text-muted" />}>
        <div className={styles.coverageLead}><strong>{percentage(p.withEmail, p.total).toFixed(0)}<span>%</span></strong><span>with an email address</span></div>
        <div className={styles.coverageList}>
          {[
            { label: "Email", value: p.withEmail }, { label: "Phone", value: p.withPhone },
            { label: "Website", value: p.withWebsite }, { label: "Owner / pharmacist", value: p.withOwner },
          ].map(field => <div key={field.label} className={styles.coverageItem}>
            <div><span>{field.label}</span><strong>{number(field.value)}<span>{percentage(field.value, p.total).toFixed(1).replace(/\.0$/, "")}%</span></strong></div>
            <div className={styles.track}><span style={{ width: `${percentage(field.value, p.total)}%` }} /></div>
          </div>)}
        </div>
      </Panel>

      <Panel title="Verification status" action={<Link href="/verification" aria-label="View verification overview" className={styles.iconLink}><Icon name="open_in_new" size={16} /></Link>}>
        <div className={styles.verificationSummary}>
          <svg viewBox="0 0 116 116" role="img" aria-label={`Verification status: ${verification.map(row => `${row.label}: ${row.value}`).join(", ")}`}>
            <circle cx="58" cy="58" r="49" fill="none" stroke="rgb(var(--line))" strokeWidth="9" />
            <g transform="rotate(-90 58 58)">{verification.filter(row => row.value).map(row => {
              const length = p.total ? row.value / p.total * circumference : 0;
              const segment = <circle key={row.label} cx="58" cy="58" r="49" fill="none" stroke={row.color} strokeWidth="9" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset}><title>{`${row.label}: ${number(row.value)}`}</title></circle>;
              offset += length; return segment;
            })}</g>
            <text x="58" y="57" textAnchor="middle" className={styles.donutValue}>{number(p.total)}</text><text x="58" y="74" textAnchor="middle" className={styles.donutLabel}>pharmacies</text>
          </svg>
          <div><span className={styles.quietLabel}>VERIFIED</span><strong>{percentage(p.verified, p.total).toFixed(0)}<span>%</span></strong><Link href="/verification/work">View queue <Icon name="chevron_right" size={14} /></Link></div>
        </div>
        <ul className={styles.verificationLegend}>{verification.map(row => <li key={row.label}><span style={{ background: row.color }} /><span>{row.label}</span><strong>{number(row.value)}</strong></li>)}</ul>
      </Panel>

      <Panel title="Pharmacy network" action={<span className={styles.pill}>{p.stateCount} states</span>}>
        <div className={styles.stateList}>{p.byState.slice(0, 5).map((state, i) => <Link href={`/pharmacies?state=${encodeURIComponent(state.state)}`} key={state.state} className={styles.stateRow}>
          <span className={styles.stateRank}>{String(i + 1).padStart(2, "0")}</span><div><div><span>{STATE_NAMES[state.state] || state.state}</span><strong>{number(state.count)}</strong></div><div className={styles.track}><span style={{ width: `${state.count / topState * 100}%` }} /></div></div>
        </Link>)}</div>
        <Link href="/pharmacies" className={styles.panelFooterLink}>Explore all pharmacies<Icon name="chevron_right" size={16} /></Link>
      </Panel>
    </div>

    <div className={styles.recordsRow}>
      <Panel title="Pharmacy overview" action={<Link href="/pharmacies" className={styles.textLink}>View all<Icon name="chevron_right" size={15} /></Link>} className={styles.pharmacyPanel}>
        <div className={styles.tableScroll}><table className={styles.pharmacyTable}>
          <thead><tr><th>Pharmacy</th><th>Location</th><th>Contact</th><th>Status</th></tr></thead>
          <tbody>{p.pharmacies.map(pharmacy => <tr key={pharmacy.id}>
            <td><Link href={`/pharmacies/${pharmacy.id}`} className={styles.pharmacyName}><span>{pharmacy.canonicalName.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span><strong>{pharmacy.canonicalName}</strong></Link></td>
            <td><span className={styles.location}>{pharmacy.city || "—"}</span><span className={styles.tableMuted}>{STATE_NAMES[pharmacy.state || ""] || pharmacy.state || "—"}</span></td>
            <td><div className={styles.contactIcons}><span title={pharmacy.email ? "Email available" : "No email recorded"} className={pharmacy.email ? styles.contactAvailable : styles.contactMissing}><Icon name="mail" size={16} /><span className="sr-only">{pharmacy.email ? "Email available" : "No email recorded"}</span></span><span title={pharmacy.phone ? "Phone available" : "No phone recorded"} className={pharmacy.phone ? styles.contactAvailable : styles.contactMissing}><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 2H3.5A1.5 1.5 0 0 0 2 3.5C2 11.5 8.5 18 16.5 18a1.5 1.5 0 0 0 1.5-1.5V14l-4-1-1.5 2a12 12 0 0 1-7.5-7.5L7 6z" /></svg><span className="sr-only">{pharmacy.phone ? "Phone available" : "No phone recorded"}</span></span></div></td>
            <td><Link href={`/pharmacies/${pharmacy.id}`} className={styles.recordLink}><span className={styles.recordStatus}>{pharmacy.verificationStatus === "READY_FOR_VERIFICATION" ? "Awaiting review" : pharmacy.verificationStatus.replace(/_/g, " ").toLowerCase()}</span><Icon name="chevron_right" size={14} /><span className="sr-only">View {pharmacy.canonicalName}</span></Link></td>
          </tr>)}</tbody>
        </table></div>
        {!p.pharmacies.length && <p className={styles.empty}>No pharmacy records yet.</p>}
        <div className={styles.tableFooter}><span>{p.pharmacies.length} of {number(p.total)} pharmacies</span><Link href="/pharmacies">Open registry<Icon name="chevron_right" size={14} /></Link></div>
      </Panel>

      <Panel title="Recent activity" action={<Link href="/audit" className={styles.textLink}>View log<Icon name="chevron_right" size={15} /></Link>}>
        <ol className={styles.timeline}>{p.recent.slice(0, 5).map(event => {
          const content = EVENT_LABELS[event.eventType] || { label: event.eventType.replace(/_/g, " ").toLowerCase(), icon: "history" as const };
          return <li key={event.id}><span className={styles.timelineIcon}><Icon name={content.icon} size={15} /></span><div><strong>{content.label}</strong><span>{event.actor || "Workspace"}</span></div><time dateTime={event.createdAt.toISOString()}>{date(event.createdAt)}</time></li>;
        })}</ol>
        {!p.recent.length && <p className={styles.empty}>No activity recorded yet.</p>}
        {p.batch && <Link href="/data/batches" className={styles.importSummary}><span className={styles.importIcon}><Icon name="inventory_2" size={18} /></span><span><strong>Latest import</strong><span>{number(p.batch.recordsAccepted)} pharmacy records{p.batch.completedAt ? ` · ${date(p.batch.completedAt)}` : ""}</span></span><Icon name="chevron_right" size={16} /></Link>}
      </Panel>
    </div>

    {p.showOutreach && <div className={styles.outreachStrip} aria-label="Outreach summary"><span><Icon name="send" size={16} />Outreach snapshot</span><span><strong>{number(p.accepted)}</strong>provider accepted</span><span><strong>{number(p.replies)}</strong>replies</span><span><strong>{number(p.capacity)}</strong>remaining capacity</span><Link href="/campaigns">View campaigns<Icon name="chevron_right" size={15} /></Link></div>}
  </div>;
}

function Priority({ href, icon, label, value, tone }: { href: string; icon: IconName; label: string; value: number; tone: string }) {
  return <Link href={href} className={styles.priority}><span className={`${styles.priorityIcon} ${styles[tone]}`}><Icon name={icon} size={19} /></span><span>{label}</span><strong>{number(value)}</strong><Icon name="chevron_right" size={16} /></Link>;
}
