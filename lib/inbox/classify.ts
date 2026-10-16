/**
 * What kind of reply is this?
 *
 * Every outreach tool sorts replies for you, and most describe it as sentiment analysis. This
 * does the same job by reading the message, but it states its reasoning and it declines when it
 * is not sure: an UNCATEGORISED reply that a person reads is a small cost, and a real buyer
 * filed under "not interested" by a confident guess is a lost customer.
 *
 * The categories that matter most are the two nobody thinks about. An out-of-office reply is not
 * a reply - treating it as one retires a live prospect on the strength of a vacation responder.
 * An unsubscribe request written in prose ("take me off your list") is legally an opt-out even
 * though nobody clicked the link, and missing it is how a CAN-SPAM complaint starts.
 */

export const CATEGORIES = [
  "UNCATEGORISED", "INTERESTED", "QUESTION", "NOT_INTERESTED", "WRONG_PERSON",
  "UNSUBSCRIBE_REQUEST", "OUT_OF_OFFICE", "AUTO_REPLY", "BOUNCE",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  UNCATEGORISED: "Needs reading",
  INTERESTED: "Interested",
  QUESTION: "Asked a question",
  NOT_INTERESTED: "Not interested",
  WRONG_PERSON: "Wrong person",
  UNSUBSCRIBE_REQUEST: "Asked to be removed",
  OUT_OF_OFFICE: "Out of office",
  AUTO_REPLY: "Automatic reply",
  BOUNCE: "Bounced",
};

export const CATEGORY_TONE: Record<Category, "ok" | "bad" | "warn" | "info" | "neutral"> = {
  UNCATEGORISED: "neutral", INTERESTED: "ok", QUESTION: "info",
  NOT_INTERESTED: "warn", WRONG_PERSON: "warn", UNSUBSCRIBE_REQUEST: "bad",
  OUT_OF_OFFICE: "neutral", AUTO_REPLY: "neutral", BOUNCE: "bad",
};

/**
 * Categories that mean a human is actually talking to us. Only these stop a sequence and count
 * towards a reply rate - an auto-responder is not engagement, and counting it as engagement
 * flatters the numbers and strands the prospect.
 */
export const HUMAN_REPLY: readonly Category[] =
  ["INTERESTED", "QUESTION", "NOT_INTERESTED", "WRONG_PERSON", "UNSUBSCRIBE_REQUEST"];

/** Categories where nothing further should be sent, ever. */
export const STOP_OUTREACH: readonly Category[] =
  ["NOT_INTERESTED", "UNSUBSCRIBE_REQUEST", "BOUNCE"];

export type Verdict = { category: Category; reason: string };

type Rule = { category: Category; reason: string; test: RegExp };

/**
 * Phrases are matched against the first part of the message only - see FIRST_CHARS. A quoted
 * thread underneath repeats our own words back to us, and "let me know if you are interested"
 * in our own footer would otherwise mark every reply INTERESTED.
 */
const FIRST_CHARS = 700;

const UNSUBSCRIBE: Rule[] = [
  { category: "UNSUBSCRIBE_REQUEST", reason: 'asked to be taken off the list',
    test: /\b(take|remove|delete)\s+(me|us|this|my\s+\w+|our\s+\w+)?\s*(off|from)\b[^.!?]{0,40}\b(list|mailing|database|emails?)\b/i },
  { category: "UNSUBSCRIBE_REQUEST", reason: 'said "unsubscribe"',
    test: /\bunsubscribe\b|\bopt[\s-]?out\b/i },
  { category: "UNSUBSCRIBE_REQUEST", reason: "asked not to be contacted again",
    // Suffixes matter here: "stop emailing me" is the commonest phrasing there is, and \bemail\b
    // does not match "emailing".
    test: /\b(do\s*n[o']?t|please\s+(do\s*n[o']?t|no\s+more)|stop)\b[^.!?]{0,30}\b(contact|email|e-mail|writ|messag|send)\w*/i },
  { category: "UNSUBSCRIBE_REQUEST", reason: "cited a do-not-contact or legal request",
    test: /\b(cease\s+and\s+desist|do\s+not\s+call\s+list|remove\s+from\s+your\s+records)\b/i },
];

const OUT_OF_OFFICE: Rule[] = [
  { category: "OUT_OF_OFFICE", reason: "standard out-of-office wording",
    test: /\b(out\s+of\s+(the\s+)?office|away\s+from\s+(my|the)\s+(desk|office)|on\s+(vacation|holiday|annual\s+leave|leave)|currently\s+(away|unavailable))\b/i },
  { category: "OUT_OF_OFFICE", reason: "says they will reply on their return",
    test: /\b(will\s+(be\s+)?(back|return)|returning)\b[^.!?]{0,30}\b(on|in|after|monday|tuesday|wednesday|thursday|friday|\d)/i },
  { category: "OUT_OF_OFFICE", reason: "medical or parental leave",
    test: /\b(maternity|paternity|parental|sick|medical)\s+leave\b/i },
];

const WRONG_PERSON: Rule[] = [
  { category: "WRONG_PERSON", reason: "says they are not the right contact",
    test: /\b(n[o']?t|wrong)\s+(the\s+)?(right\s+)?(person|contact|one)\b|\byou\s+(have|['’]ve)\s+got\s+the\s+wrong\b/i },
  { category: "WRONG_PERSON", reason: "no longer works there",
    test: /\b(no\s+longer|not)\s+(work|employed|with)\b[^.!?]{0,25}\b(here|there|company|pharmacy|us)\b|\bhas\s+left\s+the\s+(company|pharmacy|business)\b/i },
  { category: "WRONG_PERSON", reason: "redirected us to somebody else",
    test: /\b(please\s+)?(contact|speak\s+to|reach\s+out\s+to|forward(ed)?\s+(this\s+)?to)\b[^.!?]{0,40}\b(instead|owner|manager|purchasing|buyer)\b/i },
  { category: "WRONG_PERSON", reason: "says the pharmacy has closed or been sold",
    test: /\b(we|the\s+(pharmacy|store))\s+(have|has|are|is)\s+(closed|sold|shut)\b|\bunder\s+new\s+ownership\b/i },
];

const NOT_INTERESTED: Rule[] = [
  { category: "NOT_INTERESTED", reason: "declined",
    test: /\b(not|no)\s+interested\b|\bnot\s+(at\s+this\s+time|right\s+now|for\s+us|something\s+we)\b|\bno\s+thank\s*(s|you)\b/i },
  { category: "NOT_INTERESTED", reason: "already has a supplier",
    test: /\b(already|currently)\s+(have|use|work(ing)?\s+with|sourced?)\b[^.!?]{0,30}\b(supplier|wholesaler|distributor|vendor|provider|contract)\b|\bhappy\s+with\s+(our|my)\s+current\b/i },
  { category: "NOT_INTERESTED", reason: "said they do not need it",
    test: /\b(we|i)\s+(do\s*n[o']?t|don'?t)\s+(need|require|want)\b/i },
  { category: "NOT_INTERESTED", reason: "called it spam or junk",
    test: /\b(this\s+is\s+)?(spam|junk|solicitation)\b/i },
];

const INTERESTED: Rule[] = [
  { category: "INTERESTED", reason: "asked for pricing or a catalogue",
    test: /\b(send|share|provide|email|forward)\b[^.!?]{0,30}\b(pricing|price\s+list|prices|quote|catalog(ue)?|line\s+card|terms|information|details)\b|\bwhat\s+(are|is)\s+your\s+(pricing|prices|terms)\b/i },
  { category: "INTERESTED", reason: "asked to talk or meet",
    test: /\b(happy|glad|like|love|want|keen)\s+to\s+(talk|chat|speak|discuss|learn|hear)\b|\b(schedule|set\s+up|book|arrange)\s+a?\s*(call|meeting|time)\b|\bgive\s+me\s+a\s+call\b/i },
  { category: "INTERESTED", reason: "said yes",
    test: /\b(yes|sure|absolutely|definitely)[,!.\s]+(please|i|we|that|send|interested)\b|\b(we|i)\s*(are|am|'?m|'?re)\s+interested\b/i },
];

/**
 * Rules run in this order and the first match wins, which encodes a deliberate precedence.
 * An unsubscribe request outranks everything - somebody can decline politely and still be
 * asking to be removed, and the removal is the part with legal weight. Out-of-office runs
 * before the sentiment rules because a vacation responder containing "I would be happy to
 * help on my return" is not interest.
 */
const RULES: Rule[] = [...UNSUBSCRIBE, ...OUT_OF_OFFICE, ...WRONG_PERSON,
                       ...NOT_INTERESTED, ...INTERESTED];

/** Headers that say outright that no person composed this. RFC 3834 and common extensions. */
export function looksAutomated(headers: Record<string, string> = {}): string | null {
  const h = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  if (h["auto-submitted"] && h["auto-submitted"].toLowerCase() !== "no")
    return `Auto-Submitted: ${h["auto-submitted"]}`;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"])
    return "carries an auto-reply header";
  if (h["precedence"] && /bulk|auto_reply|junk|list/i.test(h["precedence"]))
    return `Precedence: ${h["precedence"]}`;
  if (h["x-failed-recipients"]) return "carries X-Failed-Recipients";
  return null;
}

/**
 * Strips the quoted thread so phrases in our own message are not read as the reply.
 *
 * Cutting at the first quote marker is blunt, and it is meant to be: somebody who writes their
 * answer underneath our text loses nothing that changes the category, while reading the whole
 * body would classify our own footer on every single message.
 */
export function replyBody(text: string): string {
  const markers = [
    /^\s*On .{0,120}\bwrote:\s*$/im,          // Gmail, Apple Mail
    /^\s*-{2,}\s*Original Message\s*-{2,}/im, // Outlook
    /^\s*_{5,}\s*$/m,                          // Outlook's rule
    /^\s*From:\s.+$/im,                        // forwarded header block
    /^\s*>{1,}/m,                              // plain quoting
  ];
  let cut = text.length;
  for (const m of markers) {
    const hit = m.exec(text);
    if (hit && hit.index < cut) cut = hit.index;
  }
  return text.slice(0, cut).trim();
}

/**
 * Categorise one inbound message.
 *
 * `isBounce` comes from the sync, which reads the provider's own bounce signals - that is a
 * fact about delivery and always outranks anything the text says.
 */
export function classifyReply(input: {
  subject?: string | null;
  bodyText?: string | null;
  headers?: Record<string, string>;
  isBounce?: boolean;
}): Verdict {
  if (input.isBounce)
    return { category: "BOUNCE", reason: "the provider reported this as a bounce" };

  const subject = (input.subject ?? "").trim();
  const body = replyBody(input.bodyText ?? "");
  const head = `${subject}\n${body}`.slice(0, FIRST_CHARS);

  // Subjects are prefixed by the mail system itself and are the most reliable signal there is.
  if (/^\s*(automatic reply|auto(matic)?[\s-]?response|out of (the )?office|ooo\b|away)/i
      .test(subject))
    return { category: "OUT_OF_OFFICE", reason: `the subject says "${subject.slice(0, 40)}"` };
  if (/^\s*(undeliverable|delivery (status notification|has failed)|returned mail|mail delivery)/i
      .test(subject))
    return { category: "BOUNCE", reason: `the subject says "${subject.slice(0, 40)}"` };

  // A message can be both automated and meaningful: an out-of-office is automated and tells us
  // to come back later. So read the text first, and fall back to the headers.
  for (const rule of RULES) if (rule.test.test(head))
    return { category: rule.category, reason: rule.reason };

  const automated = looksAutomated(input.headers);
  if (automated) return { category: "AUTO_REPLY", reason: automated };

  // A short message ending in a question mark is a question; a long one is a conversation and
  // deserves a person's eyes rather than a label.
  if (body.includes("?") && body.length < 400)
    return { category: "QUESTION", reason: "asked something, and is short enough to be just that" };

  return { category: "UNCATEGORISED", reason: "no rule matched with enough confidence" };
}
