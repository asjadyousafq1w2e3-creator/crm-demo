/**
 * Starting points for a campaign.
 *
 * Every greeting uses a fallback - {{contact_name|there}} rather than {{contact_name}} - because
 * only 14% of this registry's mailable records carry a contact name. Without it, most recipients
 * would open with "Hello," which reads as a mail merge that broke, and that impression is formed
 * before a word of the message is read.
 *
 * A blank textarea is the slowest part of setting up outreach, and the first draft somebody
 * writes under time pressure is usually the worst one they will ever send. These are complete
 * sequences - an opening message and the follow-ups that go with it - so the spacing and the
 * escalation are decided by someone who thought about it rather than improvised at 5pm.
 *
 * They are deliberately claim-free. Nothing here promises a percentage saved, a delivery time or
 * a price, because this file cannot know any of those and an invented figure in a cold email is
 * both a bad first impression and, if it is wrong, a legal problem. Where a specific belongs,
 * the wording leaves an obvious gap for it and the editor says so.
 *
 * Built-ins live in code rather than in the database on purpose: they ship with the application,
 * cannot be deleted by accident, and are the same on every deployment. Anything an operator
 * writes themselves is saved as an EmailTemplate row and appears alongside them.
 */
import { prisma } from "../db";

export type TemplateStep = {
  waitDays: number;
  /** Empty keeps the follow-up on the original thread, which is how a real one reads. */
  subject?: string;
  bodyText: string;
};

export type CampaignTemplate = {
  id: string;
  name: string;
  /** One line on when to reach for this one. */
  purpose: string;
  /** The judgement behind the wording, so it can be disagreed with rather than just used. */
  rationale: string;
  subject: string;
  bodyText: string;
  followUps: TemplateStep[];
};

export const BUILT_INS: CampaignTemplate[] = [
  {
    id: "wholesale-intro",
    name: "Wholesale introduction",
    purpose: "First contact with a pharmacy that has never heard from you.",
    rationale:
      "Says who you are, why you are writing and what happens next, in under a hundred words. "
      + "A cold email that takes longer than fifteen seconds to understand is deleted before it "
      + "is understood.",
    subject: "Wholesale supply for {{pharmacy_name}}",
    bodyText: [
      "Hello {{contact_name|there}},",
      "",
      "I work with independently owned pharmacies on wholesale supply, and {{pharmacy_name}} came "
      + "up as one of the independents still serving {{city}}.",
      "",
      "If it would be useful, I can send our current line card and terms so you have them to "
      + "compare against what you pay now. No call needed — just reply and I will send it over.",
      "",
      "If you are happy with your current supplier, say so and I will leave it there.",
      "",
      "Best regards,",
    ].join("\n"),
    followUps: [
      { waitDays: 4, bodyText: [
        "Hello {{contact_name|there}},",
        "",
        "Following up on the note below — would the line card be useful to have on file?",
        "",
        "Happy to send it with no expectation either way.",
      ].join("\n") },
      { waitDays: 7, bodyText: [
        "Hello {{contact_name|there}},",
        "",
        "I will stop here so I am not cluttering your inbox.",
        "",
        "If supply ever becomes something you want to look at, my details are below and you are "
        + "welcome to get in touch directly.",
      ].join("\n") },
    ],
  },

  {
    id: "short-direct",
    name: "Short and direct",
    purpose: "When you would rather ask one question than make a pitch.",
    rationale:
      "Three sentences, one question, an easy no. This tends to get more replies than a longer "
      + "message, including more useful negative ones - a fast 'no' is worth more than silence "
      + "because it clears the record.",
    subject: "Quick question about supply",
    bodyText: [
      "Hello {{contact_name|there}},",
      "",
      "Are you open to comparing wholesale pricing for {{pharmacy_name}} this quarter?",
      "",
      "If yes, I will send our line card. If not, no problem at all — just say so and I will "
      + "close the file.",
      "",
      "Best regards,",
    ].join("\n"),
    followUps: [
      { waitDays: 5, bodyText: [
        "Hello {{contact_name|there}},",
        "",
        "Just this one follow-up in case the note below arrived on a busy day.",
        "",
        "A yes or a no both work.",
      ].join("\n") },
    ],
  },

  {
    id: "owner-direct",
    name: "Owner to owner",
    purpose: "When the record has a named owner and the decision is theirs.",
    rationale:
      "Uses the owner's name and says plainly why you are writing to them rather than to the "
      + "counter. Falls back gracefully: if no owner name is on the record the greeting still "
      + "reads correctly, because an unmatched token renders as nothing.",
    subject: "{{pharmacy_name}} — wholesale terms",
    bodyText: [
      "Hello {{owner_name|there}},",
      "",
      "I am writing to you rather than the counter because supply terms are usually an owner's "
      + "decision.",
      "",
      "We supply independent pharmacies and I would like to send you our current terms so you "
      + "have something to hold up against your existing account. It is a one-page comparison, "
      + "not a sales call.",
      "",
      "Would that be welcome?",
      "",
      "Best regards,",
    ].join("\n"),
    followUps: [
      { waitDays: 5, bodyText: [
        "Hello {{owner_name|there}},",
        "",
        "Checking once more on the note below — shall I send the terms across?",
      ].join("\n") },
      { waitDays: 9, subject: "Closing the file on {{pharmacy_name}}", bodyText: [
        "Hello {{owner_name|there}},",
        "",
        "No reply is an answer, so I will close this off.",
        "",
        "If it becomes relevant later, my details are below.",
      ].join("\n") },
    ],
  },

  {
    id: "local-angle",
    name: "Local and independent",
    purpose: "Leads with the fact that you supply independents specifically.",
    rationale:
      "Independent pharmacists are pitched constantly by suppliers set up for chains. Saying "
      + "early that you work with independents is the one thing that makes a cold email from a "
      + "wholesaler worth reading, and it is also simply true of this list.",
    subject: "Supply for independents in {{state}}",
    bodyText: [
      "Hello {{contact_name|there}},",
      "",
      "We work with independently owned pharmacies rather than chains, which usually means "
      + "smaller order minimums and somebody who answers the phone.",
      "",
      "{{pharmacy_name}} is on our list of independents in {{city}}. Would you like me to send "
      + "our line card and current terms?",
      "",
      "If you already have a supplier you are happy with, just say no and I will leave you be.",
      "",
      "Best regards,",
    ].join("\n"),
    followUps: [
      { waitDays: 4, bodyText: [
        "Hello {{contact_name|there}},",
        "",
        "Following up briefly — would the line card be worth having on file?",
      ].join("\n") },
      { waitDays: 8, bodyText: [
        "Hello {{contact_name|there}},",
        "",
        "Last note from me. If supply comes up for review at any point, I am easy to reach.",
      ].join("\n") },
    ],
  },

  {
    id: "reconnect",
    name: "Reconnecting",
    purpose: "For a list you have written to before, or contacts who went quiet.",
    rationale:
      "Only honest if you really have been in touch before. Sending this to a pharmacy that has "
      + "never heard from you is a lie that gets found out in one reply, so the editor warns "
      + "about it and the first line is easy to delete.",
    subject: "Picking this back up — {{pharmacy_name}}",
    bodyText: [
      "Hello {{contact_name|there}},",
      "",
      "We were in touch about wholesale supply for {{pharmacy_name}} a while back and it never "
      + "went anywhere.",
      "",
      "Our terms have moved since then, so if it is worth another look I can send the current "
      + "line card. If the answer is still no, that is completely fine and I will note it.",
      "",
      "Best regards,",
    ].join("\n"),
    followUps: [
      { waitDays: 6, bodyText: [
        "Hello {{contact_name|there}},",
        "",
        "One follow-up on the below, then I will leave it.",
      ].join("\n") },
    ],
  },

  {
    id: "blank",
    name: "Start from scratch",
    purpose: "An empty message with the variables listed.",
    rationale: "Sometimes the right template is none of them.",
    subject: "",
    bodyText: "Hello {{contact_name|there}},\n\n\n\nBest regards,",
    followUps: [],
  },
];

export function builtIn(id: string): CampaignTemplate | undefined {
  return BUILT_INS.find((t) => t.id === id);
}

/** Templates an operator saved, newest first, alongside the built-ins. */
export async function savedTemplates() {
  return prisma.emailTemplate.findMany({
    where: { kind: "CAMPAIGN" }, orderBy: { updatedAt: "desc" },
  });
}

/**
 * Everything offered in the picker.
 *
 * Saved templates come first because somebody who has written their own has already decided the
 * built-ins were not quite right, and making them scroll past the rejected ones every time is a
 * small insult repeated daily.
 */
export async function templateLibrary(): Promise<CampaignTemplate[]> {
  const saved = await savedTemplates();
  return [
    ...saved.map((t) => ({
      id: `saved-${t.id}`,
      name: t.name,
      purpose: t.purpose ?? "Saved by your team.",
      rationale: t.lastUsedAt
        ? `Used ${t.timesUsed} ${t.timesUsed === 1 ? "time" : "times"}, most recently ${
            t.lastUsedAt.toISOString().slice(0, 10)}.`
        : "Not used yet.",
      subject: t.subject ?? "",
      bodyText: t.bodyText,
      followUps: [],
    })),
    ...BUILT_INS,
  ];
}

/** Records that a template was actually used, which is what makes the list worth sorting. */
export async function noteTemplateUse(id: string) {
  if (!id.startsWith("saved-")) return;
  const numeric = Number(id.slice("saved-".length));
  if (!Number.isFinite(numeric)) return;
  await prisma.emailTemplate.update({
    where: { id: numeric },
    data: { timesUsed: { increment: 1 }, lastUsedAt: new Date() },
  }).catch(() => { /* a template deleted mid-edit is not worth failing the campaign for */ });
}
