import { requirePagePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkDomain, type Check } from "@/lib/mail/deliverability";
import { Card, Empty, Note, PageHeader } from "@/components/ui";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  PASS: "tone-ok",
  WARN: "tone-warn",
  FAIL: "tone-bad",
  UNKNOWN: "tone-neutral",
};

export default async function Deliverability() {
  // Viewing is gated as well as acting: a role without this permission
  // cannot reach the page by typing the URL.
  await requirePagePermission("mailbox.manage");
  const mailboxes = await prisma.mailbox.findMany({
    where: { status: { not: "DISCONNECTED" } }, orderBy: { id: "asc" } });
  const domains = [...new Set(mailboxes.map((m) => m.domain).filter((d): d is string => Boolean(d)))];
  const results: { domain: string; checks: Check[] }[] = [];
  for (const d of domains) results.push({ domain: d, checks: await checkDomain(d) });

  return (
    <>
      <PageHeader title="Deliverability"
        subtitle="What each sending domain publishes in DNS. These are configuration checks, not a deliverability score and not a prediction of inbox placement." />

      {/* The number that decides inbox placement is not on this page, and cannot be. */}
      <Note tone="info">
        <strong>The one figure this page cannot show you is the one that matters most.</strong>{" "}
        Gmail junks a domain whose spam-complaint rate reaches 0.3%, and recovery needs seven
        consecutive days back under it. Only the receiver knows that number — no sending system
        can measure it, and any that claims to is guessing. Register the sending domain at{" "}
        <a href="https://postmaster.google.com" target="_blank" rel="noopener noreferrer"
           className="link">Google Postmaster Tools</a>{" "}
        and read it there. Aim below 0.1%.
      </Note>

      <Note tone="neutral">
        These are DNS reads. A pass means the record is published and well-formed — not that any
        particular message will authenticate at the receiver, and not a prediction of inbox
        placement. Nothing here measures deliverability, because nothing in this system can.
      </Note>

      {domains.length === 0 ? (
        <Card><Empty>
          No connected mailbox has a domain to check. Connect a mailbox and its domain appears here.
        </Empty></Card>
      ) : results.map(({ domain, checks }) => (
        <Card key={domain} title={domain}
          subtitle={`${mailboxes.filter((m) => m.domain === domain).length} mailbox(es) sending from this domain`}
          pad={false}>
          <table className="tbl">
            <thead><tr><th>Check</th><th>Result</th><th>Record</th><th>Detail</th></tr></thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.name}>
                  <td className="font-medium">{c.name}</td>
                  <td><span className={`badge ${TONE[c.state]}`}>{c.state.toLowerCase()}</span></td>
                  <td className="text-[11px] text-muted font-mono break-all max-w-[280px]">{c.record ?? "—"}</td>
                  <td className="text-[12px] text-muted">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <Card title="How to read this" className="text-[12px] text-muted">
        <div className="space-y-1.5">
        <div>· <span className="text-ink">SPF</span> is read from the domain&apos;s TXT records and
          its DNS lookup cost is counted. Past ten lookups a receiver must return{" "}
          <code>permerror</code> and SPF fails outright, however correct the record looks — it is
          one of the commonest silent authentication failures there is.</div>
        <div>· <span className="text-ink">DMARC</span> is read the same way, including{" "}
          <code>pct=</code> (a policy applied to only part of your mail reads stricter than it
          behaves) and <code>rua=</code> (without it nobody receives the reports that would show a
          legitimate sender failing).</div>
        <div>· <span className="text-ink">DKIM</span> is looked for at ten common selectors. DNS
          cannot be enumerated, so a miss is reported UNKNOWN and never as a failure — absence of
          evidence is not evidence of absence. A key published with an empty <code>p=</code> is
          the exception: that is a revoked key, and it is reported as a failure.</div>
        <div>· Nothing here tracks opens, delivery confirmation or inbox placement. The application
          does not measure those and does not estimate them.</div>
        <div>· Current mode: <code>EMAIL_MODE={config.emailMode}</code>,
          <code> ENABLE_LIVE_EMAIL_SENDING={String(config.liveSendingEnabled)}</code>.</div>
        </div>
      </Card>
    </>
  );
}
