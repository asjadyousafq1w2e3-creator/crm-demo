/**
 * Domain authentication checks.
 *
 * These are DNS reads only - they report what the domain publishes. They are NOT a deliverability
 * score and must never be presented as one. DKIM in particular cannot be verified from DNS alone
 * without knowing the selector Gmail signs with, so it is reported UNKNOWN rather than guessed.
 */
import { promises as dns } from "node:dns";
import { isCrmShowcase } from "../showcase-mode";

export type CheckState = "PASS" | "FAIL" | "WARN" | "UNKNOWN";
export type Check = { name: string; state: CheckState; detail: string; record?: string };

async function txt(name: string): Promise<string[] | null> {
  try {
    return (await dns.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    return null;
  }
}

/**
 * How many DNS lookups an SPF record costs to evaluate.
 *
 * SPF has a hard limit of ten. Past it, a receiver is required to return `permerror`, which means
 * SPF does not merely fail to help - it fails outright, and the domain is treated as unauthorised
 * no matter how correct the record looks. It is one of the most common silent authentication
 * failures there is, because the record reads fine and nothing in it is wrong; it simply grew one
 * `include:` too many as services were added over the years.
 *
 * Counted the way RFC 7208 counts: include, a, mx, ptr, exists and redirect each cost one, and
 * include and redirect are followed recursively. The `all`, `ip4` and `ip6` mechanisms are free.
 */
const SPF_LOOKUP_LIMIT = 10;

async function spfLookupCost(
  record: string, seen = new Set<string>(), depth = 0,
): Promise<{ count: number; truncated: boolean }> {
  if (depth > 10) return { count: 0, truncated: true };
  let count = 0;
  let truncated = false;

  for (const term of record.split(/\s+/)) {
    const mech = term.replace(/^[+\-~?]/, "");
    const [kind, value] = mech.split(/[:=]/, 2);
    const k = kind.toLowerCase();

    if (!["include", "a", "mx", "ptr", "exists", "redirect"].includes(k)) continue;
    count += 1;

    if ((k === "include" || k === "redirect") && value && !seen.has(value)) {
      seen.add(value);
      const nested = (await txt(value))?.find((r) => r.toLowerCase().startsWith("v=spf1"));
      if (!nested) { truncated = true; continue; }
      const sub = await spfLookupCost(nested, seen, depth + 1);
      count += sub.count;
      truncated = truncated || sub.truncated;
    }
  }
  return { count, truncated };
}

export async function checkSpf(domain: string): Promise<Check> {
  const records = await txt(domain);
  if (records === null)
    return { name: "SPF", state: "UNKNOWN", detail: "DNS lookup failed or returned no TXT records." };
  const spf = records.find((r) => r.toLowerCase().startsWith("v=spf1"));
  if (!spf) return { name: "SPF", state: "FAIL", detail: "No v=spf1 record published for this domain." };
  const includesGoogle = /include:_spf\.google\.com/i.test(spf);
  const all = /[-~?+]all\b/i.exec(spf)?.[0] ?? "";
  if (!includesGoogle)
    return { name: "SPF", state: "WARN", record: spf,
      detail: "SPF exists but does not include _spf.google.com, so Gmail sending is not authorised by it." };
  if (all === "+all")
    return { name: "SPF", state: "WARN", record: spf, detail: "SPF ends in +all, which authorises any sender." };
  const cost = await spfLookupCost(spf);
  if (cost.count > SPF_LOOKUP_LIMIT)
    return { name: "SPF", state: "FAIL", record: spf,
      detail: `Costs ${cost.count} DNS lookups to evaluate, over the hard limit of `
            + `${SPF_LOOKUP_LIMIT}. Receivers return permerror and treat SPF as failed outright. `
            + "Flatten or remove an include:." };
  if (cost.count >= SPF_LOOKUP_LIMIT - 1)
    return { name: "SPF", state: "WARN", record: spf,
      detail: `Costs ${cost.count} of the ${SPF_LOOKUP_LIMIT} permitted DNS lookups. One more `
            + "service and SPF stops working entirely." };

  return { name: "SPF", state: "PASS", record: spf,
    detail: `Published, includes _spf.google.com${all ? ` (${all})` : ""}, and costs `
          + `${cost.count}${cost.truncated ? "+" : ""} of ${SPF_LOOKUP_LIMIT} DNS lookups.` };
}

export async function checkDmarc(domain: string): Promise<Check> {
  const records = await txt(`_dmarc.${domain}`);
  if (records === null)
    return { name: "DMARC", state: "FAIL", detail: "No _dmarc TXT record found." };
  const rec = records.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  if (!rec) return { name: "DMARC", state: "FAIL", detail: "TXT records exist at _dmarc but none is a v=DMARC1 policy." };
  const policy = /p=(none|quarantine|reject)/i.exec(rec)?.[1]?.toLowerCase();
  if (!policy) return { name: "DMARC", state: "WARN", record: rec, detail: "DMARC record has no p= policy tag." };

  /*
   * A policy alone does not mean DMARC is doing anything useful.
   *
   * pct= applies the policy to a fraction of mail, so p=reject;pct=10 enforces on a tenth and
   * lets the rest through - a record that reads strict and behaves permissively. And without
   * rua= nobody receives the aggregate reports, which means no way to learn that a legitimate
   * source is failing authentication until recipients stop getting mail.
   */
  const pct = /\bpct=(\d+)/i.exec(rec)?.[1];
  if (pct && Number(pct) < 100)
    return { name: "DMARC", state: "WARN", record: rec,
      detail: `Policy is p=${policy} but pct=${pct}, so it is applied to only ${pct}% of mail. `
            + "The record reads stricter than it behaves." };

  const hasRua = /\brua=mailto:/i.test(rec);
  if (policy === "none" && !hasRua)
    return { name: "DMARC", state: "FAIL", record: rec,
      detail: "p=none with no rua= reporting address. Nothing is enforced and nobody is told, "
            + "so this record provides no protection and no visibility." };

  if (policy === "none")
    return { name: "DMARC", state: "WARN", record: rec,
      detail: "Policy is p=none: reports are collected but nothing is enforced." };
  const alignment = [
    /\baspf=s/i.test(rec) ? "strict SPF alignment" : null,
    /\badkim=s/i.test(rec) ? "strict DKIM alignment" : null,
  ].filter(Boolean).join(", ");

  return { name: "DMARC", state: hasRua ? "PASS" : "WARN", record: rec,
    detail: `Policy is p=${policy}${alignment ? `, ${alignment}` : ""}.`
          + (hasRua ? " Aggregate reports are being collected."
                    : " No rua= address, so nobody receives the reports that would show a "
                    + "legitimate sender failing authentication.") };
}

/**
 * DKIM cannot be confirmed without the signing selector. Google's default selector is "google",
 * so that one is probed - but a negative result proves nothing, and is reported as UNKNOWN.
 */
/**
 * Selectors worth trying before giving up.
 *
 * DKIM cannot be enumerated from DNS: you can only ask about a selector you already know, and the
 * selector is chosen by whoever signs the mail. `google` is Workspace's default and the one that
 * matters here, but a domain that has been through another provider often still signs with an
 * older selector, and reporting UNKNOWN when a key is plainly published is unhelpful.
 *
 * A miss on all of these still means UNKNOWN, never FAIL. Absence of evidence is not evidence of
 * absence, and telling an operator their DKIM is broken when it is fine would send them off
 * fixing something that works.
 */
const DKIM_SELECTORS = ["google", "default", "selector1", "selector2", "s1", "s2", "k1", "mail",
                        "dkim", "smtp"];

export async function checkDkim(domain: string): Promise<Check> {
  for (const selector of DKIM_SELECTORS) {
    const rec = await txt(`${selector}._domainkey.${domain}`);
    const found = rec?.find((r) => /(^|;)\s*v=DKIM1/i.test(r) || r.includes("p="));
    if (!found) continue;

    // A revoked key is published with an empty p=, which is worse than no record: it tells
    // receivers the signature is invalid rather than leaving DKIM simply unused.
    if (/\bp=\s*(;|$)/.test(found))
      return { name: "DKIM", state: "FAIL", record: `${selector}._domainkey`,
        detail: `The key at ${selector}._domainkey has an empty p=, which publishes it as `
              + "revoked. Signatures using this selector will be treated as invalid." };

    return { name: "DKIM", state: "PASS", record: `${selector}._domainkey: ${found.slice(0, 44)}…`,
      detail: `A DKIM key is published at the ${selector} selector.` };
  }

  return { name: "DKIM", state: "UNKNOWN",
    detail: `No key found at any of ${DKIM_SELECTORS.length} common selectors. DKIM may still be `
      + "active under one this check does not know - DNS cannot be enumerated, so absence cannot "
      + "be proved. Confirm in Google Admin → Apps → Gmail → Authenticate email." };
}

export async function checkMx(domain: string): Promise<Check> {
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) return { name: "MX", state: "FAIL", detail: "Domain publishes no MX records; it cannot receive replies." };
    const best = mx.sort((a, b) => a.priority - b.priority)[0];
    const google = mx.some((r) => /google|googlemail/i.test(r.exchange));
    return { name: "MX", state: "PASS", record: best.exchange,
      detail: google ? "Mail is routed to Google." : "Mail is routed to a non-Google host." };
  } catch {
    return { name: "MX", state: "UNKNOWN", detail: "MX lookup failed." };
  }
}

export async function checkDomain(domain: string): Promise<Check[]> {
  if (isCrmShowcase()) return ["SPF", "DKIM", "DMARC", "MX"].map(name => ({ name, state: "UNKNOWN", detail: `Sample domain ${domain}. Live DNS checks are disabled in this display-only demo.` }));
  return Promise.all([checkSpf(domain), checkDkim(domain), checkDmarc(domain), checkMx(domain)]);
}
