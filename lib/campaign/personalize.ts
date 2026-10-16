/**
 * Template variables backed by real columns only. A missing value renders as empty rather than
 * "undefined", "null" or a leftover "{{contact_name}}" - none of which may ever reach a recipient.
 */
export type PersonalizationSource = {
  canonicalName?: string | null;
  city?: string | null;
  state?: string | null;
  ownerName?: string | null;
  picName?: string | null;
  contactName?: string | null;
};

export const SUPPORTED_VARIABLES = [
  "pharmacy_name", "contact_name", "city", "state", "owner_name",
] as const;

export function personalize(template: string, p: PersonalizationSource): string {
  const values: Record<string, string> = {
    pharmacy_name: p.canonicalName?.trim() ?? "",
    contact_name: (p.contactName ?? p.picName ?? p.ownerName ?? "").trim(),
    city: p.city?.trim() ?? "",
    state: p.state?.trim() ?? "",
    owner_name: (p.ownerName ?? p.picName ?? "").trim(),
  };
  /*
   * Replace every {{token}}. Known tokens render their value, unknown ones render empty, so no
   * raw placeholder can survive into a sent message.
   *
   * A token may carry a fallback: {{contact_name|there}} renders "there" when the record has no
   * contact. That matters far more here than it looks. Only 14% of this registry's mailable
   * records carry a contact name, so "Hello {{contact_name}}," reaches most recipients as
   * "Hello," - which reads as a mail merge that failed, and a pharmacist who sees that has
   * already decided what the message is before reading a word of it.
   */
  return template.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi,
    (_m, key: string, fallback?: string) => {
      const value = values[key.toLowerCase()];
      if (value) return value;
      return (fallback ?? "").trim();
    });
}

/**
 * How often each token in a template would actually render something.
 *
 * Answered against the real audience before a campaign starts, because a token that is blank on
 * most records is not a personalisation - it is a hole in the sentence, and the only way to know
 * which is which is to count.
 */
export function tokensUsed(template: string): { token: string; fallback: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const [, key, fallback] of
       template.matchAll(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi)) {
    const k = key.toLowerCase();
    if (!seen.has(k)) seen.set(k, fallback?.trim() || null);
  }
  return [...seen].map(([token, fallback]) => ({ token, fallback }));
}

/** Collapse the whitespace a blank variable leaves behind. */
export function tidy(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?])/g, "$1")
             .replace(/\n{3,}/g, "\n\n").trim();
}

export function renderBoth(subject: string, bodyText: string, bodyHtml: string,
                           p: PersonalizationSource) {
  return {
    subject: tidy(personalize(subject, p)),
    bodyText: tidy(personalize(bodyText, p)),
    bodyHtml: personalize(bodyHtml, p),
  };
}
