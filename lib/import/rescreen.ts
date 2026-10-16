/**
 * Re-screening the registry against the current rules.
 *
 * Rules improve. When they do, records admitted under the older, weaker version have to be
 * re-examined rather than left in place - a chain that slipped through once stays in every
 * campaign until something goes looking for it.
 *
 * Nothing is deleted. A record that now fails is marked EXCLUDED with the rule that caught it,
 * which takes it out of every campaign while keeping its history, its provenance and the ability
 * to reverse the decision.
 */
import { prisma } from "../db";
import { actorFields, type Actor } from "../audit";
import {
  classify, classifyLicenceType, isOpen, judgeSharedContact, companyDomain,
} from "./classify";

export type Finding = {
  pharmacyId: number;
  name: string;
  state: string | null;
  email: string | null;
  decision: "EXCLUDE" | "REVIEW";
  rule: string;
  reason: string;
};

export type RescreenReport = {
  scanned: number;
  exclude: Finding[];
  review: Finding[];
  byRule: Record<string, number>;
};

/**
 * Examines every active record. Read-only: it reports, and `applyRescreen` acts. Keeping the two
 * apart means an operator sees exactly what would change before anything does.
 */
export async function rescreenRegistry(): Promise<RescreenReport> {
  const all = await prisma.pharmacy.findMany({
    where: { verificationStatus: { not: "EXCLUDED" } },
    select: {
      id: true, canonicalName: true, doingBusinessAs: true, pharmacyType: true,
      licenseType: true, licenseStatus: true, email: true, county: true, state: true, city: true,
    },
  });

  // Shared-contact analysis needs the whole set, so it is computed once up front.
  const byAddress = new Map<string, Set<string>>();
  const byDomain = new Map<string, Set<string>>();
  for (const p of all) {
    if (!p.email) continue;
    const place = `${p.city ?? ""}|${p.state ?? ""}`;
    const address = p.email.toLowerCase();
    (byAddress.get(address) ?? byAddress.set(address, new Set()).get(address)!).add(place);
    const domain = companyDomain(p.email);
    if (domain) (byDomain.get(domain) ?? byDomain.set(domain, new Set()).get(domain)!).add(place);
  }

  const exclude: Finding[] = [];
  const review: Finding[] = [];
  const byRule: Record<string, number> = {};
  const bump = (r: string) => { byRule[r] = (byRule[r] ?? 0) + 1; };

  for (const p of all) {
    const base = { pharmacyId: p.id, name: p.canonicalName, state: p.state, email: p.email };

    const hit = (decision: "EXCLUDE" | "REVIEW", rule: string, reason: string) => {
      bump(rule);
      (decision === "EXCLUDE" ? exclude : review).push({ ...base, decision, rule, reason });
    };

    // Same order the importer uses, so a re-screen and an import agree on every record.
    if (isOpen(p.licenseStatus) === false) {
      hit("EXCLUDE", "licence-closed", `licence status "${p.licenseStatus}"`); continue;
    }
    const byType = classifyLicenceType(p.licenseType);
    if (byType.decision === "EXCLUDE") {
      hit("EXCLUDE", byType.rule === "non-resident" ? "non-resident" : "licence-type", byType.reason);
      continue;
    }
    if ((p.county ?? "").trim().toLowerCase() === "out of state") {
      hit("EXCLUDE", "non-resident", "county says out of state"); continue;
    }
    const byName = classify(p.canonicalName, p.doingBusinessAs, p.licenseType, p.pharmacyType);
    if (byName.decision === "EXCLUDE") { hit("EXCLUDE", byName.rule, byName.reason); continue; }

    // Shared contact: the address itself first, then the company domain behind it.
    if (p.email) {
      const addressLocations = byAddress.get(p.email.toLowerCase())?.size ?? 0;
      const verdictByAddress = judgeSharedContact(p.email.toLowerCase(), addressLocations);
      if (verdictByAddress.decision !== "INCLUDE") {
        hit(verdictByAddress.decision, "shared-contact", verdictByAddress.reason); continue;
      }
      const domain = companyDomain(p.email);
      if (domain) {
        const domainLocations = byDomain.get(domain)?.size ?? 0;
        const verdictByDomain = judgeSharedContact(domain, domainLocations);
        if (verdictByDomain.decision !== "INCLUDE") {
          hit(verdictByDomain.decision, "shared-domain", verdictByDomain.reason); continue;
        }
      }
    }

    if (byName.decision === "REVIEW") hit("REVIEW", byName.rule, byName.reason);
    else if (byType.decision === "REVIEW") hit("REVIEW", "licence-type", byType.reason);
  }

  return { scanned: all.length, exclude, review, byRule };
}

/**
 * Acts on a report. Excluded records keep every field and every provenance row - they are marked,
 * not removed, so the decision is visible and reversible and the audit trail stays intact.
 */
export async function applyRescreen(
  report: RescreenReport, options: { applyReview: boolean }, actor?: Actor,
): Promise<{ excluded: number; flagged: number }> {
  let excluded = 0, flagged = 0;

  for (const f of report.exclude) {
    await prisma.pharmacy.update({
      where: { id: f.pharmacyId },
      data: {
        verificationStatus: "EXCLUDED", campaignEligible: false,
        exclusionReason: `${f.rule}: ${f.reason}`.slice(0, 400),
      },
    });
    excluded++;
  }

  if (options.applyReview) {
    for (const f of report.review) {
      await prisma.pharmacy.update({
        where: { id: f.pharmacyId },
        data: { verificationStatus: "NEEDS_REVIEW",
                exclusionReason: `${f.rule}: ${f.reason}`.slice(0, 400) },
      });
      flagged++;
    }
  }

  await prisma.auditEvent.create({
    data: { eventType: "REGISTRY_RESCREENED",
            detail: `${report.scanned.toLocaleString()} scanned · ${excluded} excluded · ` +
                    `${flagged} sent to review`,
            ...actorFields(actor) },
  });
  return { excluded, flagged };
}
