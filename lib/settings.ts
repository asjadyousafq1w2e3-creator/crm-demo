/**
 * Editable application settings. Stored in the database so an operator can change the CAN-SPAM
 * footer without a redeploy; environment variables remain the fallback and the source of truth
 * for anything security-relevant (those are NOT editable from the UI).
 */
import { prisma } from "./db";
import { config } from "./config";
import { actorFields, type Actor } from "./audit";

export const SETTING_KEYS = [
  "company.name", "company.address", "company.website", "company.replyTo",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await prisma.appSetting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    "company.name": map["company.name"] ?? config.company.name,
    "company.address": map["company.address"] ?? config.company.address,
    "company.website": map["company.website"] ?? config.company.website,
    "company.replyTo": map["company.replyTo"] ?? "",
  };
}

export async function setSettings(values: Partial<Record<SettingKey, string>>, actor?: Actor) {
  for (const [key, value] of Object.entries(values)) {
    if (!SETTING_KEYS.includes(key as SettingKey)) continue;
    await prisma.appSetting.upsert({
      where: { key }, update: { value: value ?? "" }, create: { key, value: value ?? "" } });
  }
  await prisma.auditEvent.create({
    data: { eventType: "SETTINGS_UPDATED", detail: Object.keys(values).join(", "),
            ...actorFields(actor) } });
}

/** The footer identity used on every outgoing message. */
export async function companyFooter() {
  const s = await getSettings();
  return {
    name: s["company.name"], address: s["company.address"], website: s["company.website"],
    line: [s["company.name"], s["company.address"], s["company.website"]].filter(Boolean).join(" · "),
  };
}

/**
 * Whether outgoing mail would carry a lawful footer.
 *
 * CAN-SPAM requires commercial email to identify the sender and to carry a valid physical postal
 * address. Both are in the footer this application appends to every message, which means an
 * empty settings field does not produce a slightly worse email - it produces an unlawful one,
 * and it does so silently, at whatever volume the campaign was set to.
 *
 * So this is checked before a campaign may start and again before each individual send, rather
 * than being left as advice on a settings page. The address is only checked for being present
 * and plausibly postal: whether it is genuinely the company's address is not something code can
 * know, and pretending otherwise would be worse than admitting it.
 */
export type FooterCompliance = { ok: boolean; missing: string[]; line: string };

export async function footerCompliance(): Promise<FooterCompliance> {
  const f = await companyFooter();
  const missing: string[] = [];

  if (!f.name?.trim()) missing.push("a company name");

  const address = f.address?.trim() ?? "";
  if (!address) missing.push("a physical postal address");
  else if (address.length < 12 || !/\d/.test(address))
    // A postal address without a single digit is a city name, not somewhere mail arrives.
    missing.push("a complete postal address — what is set has no street number or postcode");

  return { ok: missing.length === 0, missing, line: f.line };
}

/** One sentence an operator can act on, or null when there is nothing wrong. */
export function footerProblem(c: FooterCompliance): string | null {
  if (c.ok) return null;
  const list = c.missing.length === 1 ? c.missing[0]
    : `${c.missing.slice(0, -1).join(", ")} and ${c.missing[c.missing.length - 1]}`;
  return `Commercial email must identify the sender and carry a valid physical postal address. `
       + `This deployment is missing ${list}. Set it under Settings before sending.`;
}
