/**
 * What still stands between this deployment and contacting a real pharmacy.
 *
 * Deliberately more than a configuration check: credentials are only part of it. A system with
 * perfect environment variables and no verified records still cannot send to anybody, and saying
 * "ready" at that point would be false.
 */
import { prisma } from "./db";
import { checkConfig, config, liveSendingAllowed } from "./config";

export type ReadinessState = "done" | "todo" | "blocked" | "optional";

export type ReadinessItem = {
  id: string;
  title: string;
  state: ReadinessState;
  detail: string;
  /** Where to go to deal with it, when that is somewhere in the app. */
  href?: string;
};

export async function readiness(): Promise<{
  items: ReadinessItem[];
  canSendToRealPharmacies: boolean;
}> {
  const [mailboxes, connected, verified, validEmails, totalEmails, company] = await Promise.all([
    prisma.mailbox.count(),
    prisma.mailbox.count({ where: { status: "CONNECTED" } }),
    prisma.pharmacy.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.pharmacy.count({ where: { emailVerificationStatus: "VALID" } }),
    prisma.pharmacy.count({ where: { email: { not: null } } }),
    prisma.appSetting.findMany({ where: { key: { startsWith: "company." } } }),
  ]);

  const setting = (k: string, fallback: string) =>
    company.find((c) => c.key === k)?.value || fallback;
  const address = setting("company.address", config.company.address);
  const name = setting("company.name", config.company.name);

  const problems = checkConfig();
  const fatal = problems.filter((p) => p.fatal);
  const warnings = problems.filter((p) => !p.fatal);
  const live = liveSendingAllowed();

  const items: ReadinessItem[] = [
    {
      id: "config",
      title: "Environment configuration",
      state: fatal.length ? "blocked" : warnings.length ? "todo" : "done",
      detail: fatal.length
        ? `${fatal.length} setting(s) must be fixed: ${fatal.map((p) => p.key).join(", ")}`
        : warnings.length
          ? `Usable, with ${warnings.length} warning(s): ${warnings.map((p) => p.key).join(", ")}`
          : "Every required value is present and well-formed.",
    },
    {
      id: "company",
      title: "Company footer",
      state: name && address ? "done" : "todo",
      href: "/settings",
      detail: name && address
        ? `Outgoing mail is signed as ${name}.`
        : "A company name and a physical postal address are legally required on commercial email.",
    },
    {
      id: "mailbox",
      title: "A connected mailbox",
      state: connected > 0 ? "done" : "todo",
      href: "/settings/mailboxes",
      detail: connected > 0
        ? `${connected} of ${mailboxes} mailbox(es) connected and usable.`
        : "Nothing can be sent until at least one mailbox is connected.",
    },
    {
      id: "email-verification",
      title: "Email addresses verified",
      state: validEmails > 0 ? "done" : "blocked",
      detail: validEmails > 0
        ? `${validEmails.toLocaleString()} of ${totalEmails.toLocaleString()} addresses marked VALID.`
        : `None of the ${totalEmails.toLocaleString()} addresses has been checked for `
          + "deliverability. Expect 15-30% to fail; sending into that would burn the domain.",
    },
    {
      id: "business-verification",
      title: "Pharmacies business-verified",
      state: verified > 0 ? "done" : "blocked",
      href: "/verification",
      detail: verified > 0
        ? `${verified.toLocaleString()} record(s) verified and eligible for outreach.`
        : "No record has been verified, so eligibility correctly returns zero for every campaign.",
    },
    {
      id: "live-switch",
      title: "Live sending switch",
      state: live.allowed ? "done" : "optional",
      detail: live.allowed
        ? "EMAIL_MODE=gmail and ENABLE_LIVE_EMAIL_SENDING=true - real email will be delivered."
        : `Off, which is the safe default (${live.reason}). Turn it on only for a controlled test.`,
    },
    {
      id: "allowlist",
      title: "Test allowlist",
      state: config.liveTestAllowlist.length ? "done" : "optional",
      detail: config.liveTestAllowlist.length
        ? `${config.liveTestAllowlist.length} address(es) may receive live mail.`
        : "Empty, so live mode would refuse every address. Add internal addresses before testing.",
    },
  ];

  return {
    items,
    canSendToRealPharmacies: items.every((i) => i.state !== "blocked" && i.state !== "todo"),
  };
}
