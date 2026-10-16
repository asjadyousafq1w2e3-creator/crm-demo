/**
 * Where the data is, and what to do next.
 *
 * The system is a pipeline — records come in, get screened, get verified two different ways, then
 * get mailed — but a list of twenty menu items does not say that. This works out which stage is
 * actually blocking progress and names the one next action, so nobody has to hold the whole
 * sequence in their head.
 */
import { prisma } from "./db";
import { config } from "./config";
import { footerCompliance } from "./settings";

export type StageState = "DONE" | "CURRENT" | "BLOCKED" | "WAITING";

export type Stage = {
  key: string;
  title: string;
  /** What this stage is for, in one line. */
  purpose: string;
  state: StageState;
  /** The headline number for this stage. */
  value: number;
  valueLabel: string;
  /** What to do about it, when there is something to do. */
  action?: { label: string; href: string };
  /** Why it is blocked or waiting, when it is. */
  note?: string;
};

export type Pipeline = {
  stages: Stage[];
  /** The single thing worth doing now. */
  next: { title: string; why: string; label: string; href: string } | null;
};

export async function pipeline(): Promise<Pipeline> {
  const [
    total, excluded, needsReview, verified, emailsHeld, emailsValid, emailsChecked,
    mailboxes, campaignsRunning, eligible, sentEver,
  ] = await Promise.all([
    prisma.pharmacy.count(),
    prisma.pharmacy.count({ where: { verificationStatus: "EXCLUDED" } }),
    prisma.pharmacy.count({ where: { verificationStatus: "NEEDS_REVIEW" } }),
    prisma.pharmacy.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.pharmacy.count({ where: { email: { not: null } } }),
    prisma.pharmacy.count({ where: { emailVerificationStatus: "VALID" } }),
    prisma.pharmacy.count({
      where: { email: { not: null }, emailVerificationStatus: { not: "NOT_CHECKED" } } }),
    prisma.mailbox.count({ where: { status: "CONNECTED" } }),
    prisma.campaign.count({ where: { status: "RUNNING" } }),
    prisma.pharmacy.count({ where: {
      verificationStatus: "VERIFIED", licenseStatus: "ACTIVE", operationalStatus: "OPEN",
      ownershipStatus: { in: ["INDEPENDENT", "LOCAL_GROUP"] },
      emailVerificationStatus: "VALID", email: { not: null },
    } }),
    prisma.campaignRecipient.count({ where: { status: { in: ["SENT", "REPLIED", "BOUNCED"] } } }),
  ]);

  // An incomplete CAN-SPAM footer blocks every campaign, so it belongs on the board rather than
  // being discovered at the moment somebody presses start.
  const footer = await footerCompliance();

  const clean = total - excluded;

  // Each step reports only whether it is finished. The sequence decides what is current, so
  // exactly one step is ever the next thing to do - three simultaneous "do this" markers is
  // the same confusion as no marker at all.
  const steps: (Omit<Stage, "state"> & { done: boolean })[] = [
    {
      key: "import", done: total > 0,
      title: "Import data",
      purpose: "Load a state board file and let the rules clean it.",
      value: total, valueLabel: "records held",
      action: { label: total > 0 ? "Import another file" : "Import your first file",
                href: "/data/import/new" },
    },
    {
      key: "screen", done: total > 0,
      title: "Screen out non-customers",
      purpose: "Chains, hospitals, government, long-term care and duplicates.",
      value: excluded, valueLabel: "removed so far",
      action: { label: "Re-screen the registry", href: "/data/rescreen" },
      note: needsReview > 0
        ? `${needsReview.toLocaleString()} are uncertain and need a decision.` : undefined,
    },
    {
      key: "email", done: emailsValid > 0,
      title: "Check email addresses",
      purpose: "A verifier confirms each address is real before anything is sent.",
      value: emailsValid, valueLabel: "confirmed valid",
      action: { label: emailsChecked > 0 ? "Verify more addresses" : "Start a verification round",
                href: "/verification/email" },
      note: !config.verifier.apiKey
        ? "No verifier key is set, so rounds run as a CSV export and re-import."
        : emailsChecked === 0
          ? `None of the ${emailsHeld.toLocaleString()} addresses have been checked yet.`
          : undefined,
    },
    {
      key: "verify", done: verified > 0,
      title: "Check the businesses",
      purpose: "Confirm the licence, who owns it, and that it is still trading.",
      value: verified, valueLabel: "verified records",
      action: { label: "Work the queue", href: "/verification/work" },
      note: verified === 0 && clean > 0
        ? `${clean.toLocaleString()} records are waiting. Nothing can be mailed until a person checks them.`
        : undefined,
    },
    {
      key: "deliver", done: verified > 0,
      title: "Build the client file",
      purpose: "The eight-tab workbook of everything that passed both checks.",
      value: clean, valueLabel: "rows in the file",
      action: { label: "Open the deliverable", href: "/deliverable" },
      note: verified === 0
        ? "The file is buildable now, but it carries no verified rows yet." : undefined,
    },
    {
      key: "mailbox", done: mailboxes > 0,
      title: "Connect a mailbox",
      purpose: "The address campaigns send from.",
      value: mailboxes, valueLabel: "connected",
      action: { label: mailboxes ? "Manage mailboxes" : "Connect a mailbox",
                href: "/settings/mailboxes" },
    },
    {
      key: "campaign", done: sentEver > 0,
      title: "Run a campaign",
      purpose: "Only a record that passed both checks can be written to.",
      value: eligible, valueLabel: "eligible recipients",
      action: footer.ok
        ? { label: campaignsRunning ? "See campaigns" : "Create a campaign",
            href: campaignsRunning ? "/campaigns" : "/campaigns/new" }
        : { label: "Complete the company details", href: "/settings" },
      note: !footer.ok
        ? `No campaign can start: commercial email needs ${footer.missing.join(" and ")}.`
        : eligible === 0
          ? "A recipient needs both a verified business and a valid email address."
          : undefined,
    },
  ];

  const firstUnfinished = steps.findIndex((s) => !s.done);

  const stages: Stage[] = steps.map(({ done, ...s }, i) => ({
    ...s,
    state: done ? "DONE"
      : i === firstUnfinished
        // Blocked rather than current when the step cannot be started at all yet.
        ? (s.key === "campaign" && (eligible === 0 || mailboxes === 0 || !footer.ok)
            ? "BLOCKED" : "CURRENT")
        : "WAITING",
  }));

  const current = stages[firstUnfinished];
  const next = current?.action
    ? { title: current.title, why: current.note ?? current.purpose,
        label: current.action.label, href: current.action.href }
    : null;

  return { stages, next };
}
