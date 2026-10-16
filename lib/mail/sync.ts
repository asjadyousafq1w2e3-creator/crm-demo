import { prisma } from "../db";
import { classifyReply, HUMAN_REPLY } from "../inbox/classify";
import { suppress } from "../campaign/suppression";
import { providerFor } from "./index";
import { classifyFailure, explainFailure, mailboxStateFor } from "./errors";

/**
 * How long to hold a sequence when the recipient is out of the office.
 *
 * Long enough to clear a normal absence, short enough that the thread is still recognisable
 * when it resumes. The exact return date is usually in the message, but parsing dates out of
 * free text in every locale is a worse bet than waiting a sensible fixed period.
 */
const OOO_DEFER_DAYS = 7;
import type { ProviderMessage } from "./types";

/**
 * Reply synchronisation. Matching is by provider thread id and RFC Message-ID headers -
 * never by subject alone, which collides constantly across a campaign where every recipient
 * receives the same subject line.
 */
const addr = (raw: string) => {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
};

export async function syncAllMailboxes() {
  const mailboxes = await prisma.mailbox.findMany({ where: { status: "CONNECTED" } });
  let newMessages = 0;
  for (const m of mailboxes) newMessages += (await syncMailbox(m.id)).newMessages;
  return { mailboxes: mailboxes.length, newMessages };
}

export async function syncMailbox(mailboxId: number) {
  const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!mailbox) return { newMessages: 0, error: "mailbox not found" };

  const provider = providerFor(mailbox);
  let result;
  try {
    result = await provider.syncMessages(mailbox.gmailHistoryId);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // A revoked token never recovers on its own; anything else may. Marking them the same way
    // would leave a dead mailbox quietly failing every tick.
    const kind = classifyFailure(error);
    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { lastError: `${explainFailure(kind)}: ${error.slice(0, 300)}`,
              ...mailboxStateFor(kind) },
    });
    if (kind === "AUTH") {
      await prisma.auditEvent.create({
        data: { eventType: "MAILBOX_NEEDS_RECONNECT", actor: "worker",
                detail: `${mailbox.emailAddress}: ${error.slice(0, 160)}` } });
    }
    return { newMessages: 0, error };
  }

  let created = 0;
  for (const msg of result.messages) {
    if (await ingestInbound(mailboxId, msg)) created++;
  }
  await prisma.mailbox.update({
    where: { id: mailboxId },
    data: { gmailHistoryId: result.historyId ?? mailbox.gmailHistoryId, lastSyncedAt: new Date() },
  });
  return { newMessages: created };
}

/** Returns true when a new message row was created. */
export async function ingestInbound(mailboxId: number, msg: ProviderMessage): Promise<boolean> {
  const existing = await prisma.emailMessage.findUnique({
    where: { mailboxId_providerMessageId: { mailboxId, providerMessageId: msg.providerMessageId } },
  });
  if (existing) return false;   // idempotent: a re-sync never duplicates

  // 1. thread id is the strongest signal
  let recipient = await prisma.campaignRecipient.findFirst({
    where: { providerThreadId: msg.providerThreadId },
  });
  // 2. fall back to the RFC headers of the message we sent
  if (!recipient && (msg.inReplyTo || msg.references)) {
    const ids = [msg.inReplyTo, ...(msg.references?.split(/\s+/) ?? [])].filter(Boolean) as string[];
    const sent = await prisma.emailMessage.findFirst({
      where: { direction: "OUTBOUND", rfcMessageId: { in: ids } },
    });
    if (sent) {
      recipient = await prisma.campaignRecipient.findFirst({
        where: { providerThreadId: sent.providerThreadId },
      });
    }
  }
  // 3. last resort: the sender's address against a recipient we mailed
  const fromAddr = addr(msg.from);
  if (!recipient) {
    recipient = await prisma.campaignRecipient.findFirst({
      where: { recipientEmail: { equals: fromAddr, mode: "insensitive" }, status: "SENT" },
      orderBy: { sentAt: "desc" },
    });
  }
  if (!recipient) return false;   // unrelated mail - not campaign traffic, so not ingested

  const conversation = await prisma.conversation.upsert({
    where: { mailboxId_providerThreadId: { mailboxId, providerThreadId: msg.providerThreadId } },
    update: { unread: true, lastMessageAt: msg.receivedAt },
    create: {
      pharmacyId: recipient.pharmacyId, contactId: recipient.contactId,
      campaignId: recipient.campaignId, recipientId: recipient.id, mailboxId,
      providerThreadId: msg.providerThreadId, subject: msg.subject ?? null,
      contactEmail: recipient.recipientEmail, unread: true, lastMessageAt: msg.receivedAt,
    },
  });

  await prisma.emailMessage.create({
    data: {
      conversationId: conversation.id, mailboxId, direction: "INBOUND",
      providerMessageId: msg.providerMessageId, providerThreadId: msg.providerThreadId,
      rfcMessageId: msg.rfcMessageId, inReplyTo: msg.inReplyTo, references: msg.references,
      fromAddress: fromAddr, toAddress: addr(msg.to), ccAddress: msg.cc ?? null,
      subject: msg.subject ?? null, bodyText: msg.bodyText ?? null, bodyHtml: msg.bodyHtml ?? null,
      isBounce: msg.isBounce, receivedAt: msg.receivedAt,
    },
  });

  if (msg.isBounce) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id }, data: { status: "BOUNCED", bouncedAt: msg.receivedAt },
    });
    await prisma.suppressionEntry.upsert({
      where: { email: recipient.recipientEmail.toLowerCase() },
      update: {},
      create: {
        email: recipient.recipientEmail.toLowerCase(), reason: "BOUNCED",
        source: "inbox sync", notes: `bounce detected on thread ${msg.providerThreadId}`,
      },
    });
    await prisma.pharmacy.update({
      where: { id: recipient.pharmacyId }, data: { leadStatus: "BOUNCED" },
    });
    await prisma.auditEvent.create({
      data: { eventType: "EMAIL_BOUNCED", pharmacyId: recipient.pharmacyId, actor: "worker" },
    });
  } else {
    const verdict = classifyReply({
      subject: msg.subject, bodyText: msg.bodyText, headers: msg.headers, isBounce: false,
    });

    // An operator's own judgement is never overwritten by a later automatic pass.
    if (conversation.categorySource !== "OPERATOR")
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { category: verdict.category, categoryReason: verdict.reason,
                categorySource: "AUTOMATIC",
                // Anything that arrives re-opens a conversation somebody had put away.
                state: "OPEN", snoozedUntil: null, closedAt: null },
      });

    const human = HUMAN_REPLY.includes(verdict.category);

    if (human) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "REPLIED", repliedAt: msg.receivedAt,
                nextStepAt: null, stoppedReason: "REPLIED" },
      });
    } else {
      // An out-of-office or an autoresponder is not a reply. Marking it as one would retire a
      // live prospect on the strength of a vacation message and inflate the reply rate with
      // machines. The sequence keeps its place; only the next step moves, so we are not writing
      // into an empty office all week.
      const resumeDays = verdict.category === "OUT_OF_OFFICE" ? OOO_DEFER_DAYS : 0;
      if (resumeDays && recipient.nextStepAt) {
        await prisma.campaignRecipient.update({
          where: { id: recipient.id },
          data: { nextStepAt: new Date(Date.now() + resumeDays * 86_400_000) },
        });
      }
    }

    // A prose opt-out is legally an opt-out even though nobody clicked the link.
    if (verdict.category === "UNSUBSCRIBE_REQUEST") {
      await suppress(recipient.recipientEmail, "UNSUBSCRIBED", "inbox sync",
                     `asked in a reply: ${verdict.reason}`);
      await prisma.campaignRecipient.update({
        where: { id: recipient.id }, data: { stoppedReason: "UNSUBSCRIBED", nextStepAt: null } });
    }

    // A reply must not overwrite a classification the operator already made.
    const pharmacy = await prisma.pharmacy.findUnique({ where: { id: recipient.pharmacyId } });
    const PRESERVE = ["INTERESTED", "NOT_INTERESTED", "FOLLOW_UP", "UNSUBSCRIBED"];
    if (pharmacy && !PRESERVE.includes(pharmacy.leadStatus)) {
      const lead = verdict.category === "UNSUBSCRIBE_REQUEST" ? "UNSUBSCRIBED"
                 : verdict.category === "INTERESTED" ? "INTERESTED"
                 : verdict.category === "NOT_INTERESTED" ? "NOT_INTERESTED"
                 : human ? "REPLIED"
                 : null;   // an automated message changes nothing about the lead
      if (lead)
        await prisma.pharmacy.update({ where: { id: recipient.pharmacyId },
                                       data: { leadStatus: lead } });
    }

    await prisma.auditEvent.create({
      data: { eventType: human ? "EMAIL_REPLIED" : "EMAIL_AUTO_REPLY",
              pharmacyId: recipient.pharmacyId, actor: "worker",
              detail: `${verdict.category}: ${verdict.reason}` },
    });
  }
  return true;
}
