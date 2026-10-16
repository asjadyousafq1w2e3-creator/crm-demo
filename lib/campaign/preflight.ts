/**
 * What is wrong with this campaign, checked before it sends rather than after.
 *
 * Deliverability is mostly not about the words. It is authentication, list hygiene, complaint
 * rate and volume discipline, and those are handled elsewhere in this system. What is left for a
 * message check is a short list of things that genuinely damage a send, each of which is either
 * measurable or structural.
 *
 * Deliberately absent: a spam-trigger word list. "Free", "guarantee", "act now" and the rest are
 * folklore from 2005 filters. Modern receivers score on authentication, sending history and how
 * recipients react; a word list would give false confidence in exchange for worse writing, and
 * tuning wording to slip past a classifier is evasion rather than deliverability. This checks
 * things that are true.
 */
import { prisma } from "../db";
import { tokensUsed, type PersonalizationSource } from "./personalize";
import { footerCompliance, footerProblem } from "../settings";

export type Severity = "BLOCK" | "WARN" | "NOTE";
export type Finding = {
  severity: Severity;
  title: string;
  detail: string;
  /** What to do about it, when there is a specific thing. */
  fix?: string;
};

/**
 * Link shorteners.
 *
 * Penalised because they hide the destination, which is exactly what a phishing message does.
 * A cold email from an unknown sender containing a shortened link is close to the worst
 * combination of signals available.
 */
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "buff.ly", "is.gd",
                    "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc", "rb.gy", "lnkd.in"];

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

/** Which token values a record would actually supply. Mirrors personalize(). */
function tokenPresent(token: string, p: PersonalizationSource): boolean {
  switch (token) {
    case "pharmacy_name": return Boolean(p.canonicalName?.trim());
    case "contact_name":  return Boolean((p.contactName ?? p.picName ?? p.ownerName ?? "").trim());
    case "owner_name":    return Boolean((p.ownerName ?? p.picName ?? "").trim());
    case "city":          return Boolean(p.city?.trim());
    case "state":         return Boolean(p.state?.trim());
    default:              return false;
  }
}

export async function preflight(campaignId: number): Promise<Finding[]> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { steps: { where: { active: true }, orderBy: { stepNumber: "asc" } } },
  });
  if (!campaign) return [];

  const findings: Finding[] = [];

  // ---------------------------------------------------------------- the footer, which is law
  const footer = await footerCompliance();
  if (!footer.ok)
    findings.push({ severity: "BLOCK", title: "The CAN-SPAM footer is incomplete",
      detail: footerProblem(footer)!, fix: "Settings → company name and postal address" });

  // ---------------------------------------------------------------- personalisation that lands
  //
  // The check that matters most on this dataset. A token blank on most records is not
  // personalisation, it is a hole in a sentence, and the reader sees a mail merge that broke.
  const audience = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: { in: ["PENDING", "QUEUED", "SCHEDULED"] } },
    select: { pharmacy: {
      select: { canonicalName: true, city: true, state: true, ownerName: true, picName: true } } },
    take: 5000,
  });

  const messages = [
    { label: "the first message", subject: campaign.subject, body: campaign.bodyText },
    ...campaign.steps.map((s) => ({
      label: `step ${s.stepNumber}`, subject: s.subject ?? "", body: s.bodyText })),
  ];

  if (audience.length) {
    const counted = new Set<string>();
    for (const m of messages) {
      for (const { token, fallback } of tokensUsed(`${m.subject}\n${m.body}`)) {
        if (fallback || counted.has(token)) continue;
        counted.add(token);
        const present = audience.filter((r) => tokenPresent(token, r.pharmacy)).length;
        const blank = audience.length - present;
        if (!blank) continue;
        const pct = Math.round((blank / audience.length) * 100);

        findings.push({
          severity: pct >= 50 ? "WARN" : "NOTE",
          title: `{{${token}}} is empty for ${blank.toLocaleString()} of `
               + `${audience.length.toLocaleString()} recipients (${pct}%)`,
          detail: pct >= 50
            ? `Most of this audience has no ${token.replace(/_/g, " ")}, so the sentence around `
              + "it arrives with a gap in it — which reads as a mail merge that failed."
            : `${blank.toLocaleString()} recipients will receive the sentence with a gap in it.`,
          fix: `Write it as {{${token}|there}} — the fallback is used when the record has no value.`,
        });
      }
    }
  }

  // ---------------------------------------------------------------- links
  for (const m of messages) {
    const links = [...m.body.matchAll(URL_RE)].map((x) => x[0]);
    const shortened = links.filter((l) => SHORTENERS.some((s) => l.includes(s)));

    if (shortened.length)
      findings.push({ severity: "WARN", title: `${m.label} uses a link shortener`,
        detail: `${shortened[0]} hides where it goes, which is what a phishing message does. `
              + "From an unfamiliar sender it is close to the worst signal available.",
        fix: "Use the full URL." });

    // The unsubscribe link is appended by the sender and is not counted here.
    if (links.length > 3)
      findings.push({ severity: "NOTE", title: `${m.label} contains ${links.length} links`,
        detail: "A short message from an unknown sender with several links reads as promotional "
              + "rather than personal.",
        fix: "One link, or none, tends to do better in cold outreach." });
  }

  // ---------------------------------------------------------------- subject lines
  for (const m of messages) {
    const subject = m.subject.trim();
    if (!subject) continue;

    const letters = subject.replace(/[^a-z]/gi, "");
    if (letters.length > 6 && letters === letters.toUpperCase())
      findings.push({ severity: "WARN", title: `${m.label} has an all-capitals subject`,
        detail: `"${subject}" is shouted. It is one of the few content signals receivers still `
              + "weigh, and recipients dislike it regardless.", fix: "Use sentence case." });

    if (/[!?]{2,}/.test(subject))
      findings.push({ severity: "WARN", title: `${m.label} has repeated punctuation in the subject`,
        detail: `"${subject}" — repeated ! or ? is a long-standing promotional marker.`,
        fix: "One mark is enough." });

    if (subject.length > 70)
      findings.push({ severity: "NOTE", title: `${m.label} has a long subject`,
        detail: `${subject.length} characters. Most clients truncate around 60–70, and phones `
              + "show fewer.", fix: "Shorten it so the point survives truncation." });
  }

  // ---------------------------------------------------------------- body shape
  for (const m of messages) {
    if (!m.body.trim())
      findings.push({ severity: "BLOCK", title: `${m.label} has no body`, detail: "" });
    else if (m.body.trim().length < 40)
      findings.push({ severity: "NOTE", title: `${m.label} is very short`,
        detail: `${m.body.trim().length} characters. Short is usually good, but a message with `
              + "almost no text and a link is a shape filters treat with suspicion." });
  }

  // ---------------------------------------------------------------- follow-up spacing
  let day = 0;
  for (const step of campaign.steps) {
    day += step.waitDays;
    if (step.waitDays <= 1)
      findings.push({ severity: "WARN",
        title: `Step ${step.stepNumber} follows only ${step.waitDays} day after the last`,
        detail: "Two messages inside a day reads as automation rather than a person following up.",
        fix: "Three or four days is the usual minimum." });
  }
  if (campaign.steps.length >= 3 && day < 10)
    findings.push({ severity: "WARN", title: "The whole sequence lands inside 10 days",
      detail: `${campaign.steps.length + 1} messages in ${day} days is a lot of contact from `
            + "somebody a pharmacy has never dealt with.",
      fix: "Spread it, or drop a step." });

  const order: Record<Severity, number> = { BLOCK: 0, WARN: 1, NOTE: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
