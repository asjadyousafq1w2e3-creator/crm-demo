/** Provider-agnostic mail interface. Campaign logic never imports Gmail directly. */

export interface SendMessageInput {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** RFC-compliant opt-out header. Required on commercial mail. */
  listUnsubscribe?: string;
  /**
   * Where replies should go, when that is not the sending mailbox.
   *
   * Left unset for ordinary outreach, and that is the right default: a reply arriving back at
   * the mailbox that sent it is what lets the inbox match it to a conversation. Set it only when
   * a shared address should own the conversation instead.
   */
  replyTo?: string;
  /** Present only on replies. */
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendMessageResult {
  providerMessageId: string;
  providerThreadId: string;
  rfcMessageId?: string;
}

export interface ProviderMessage {
  providerMessageId: string;
  providerThreadId: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
  from: string;
  to: string;
  cc?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  receivedAt: Date;
  isBounce: boolean;
  /**
   * Lower-cased header map. Carried through because RFC 3834's Auto-Submitted, and the
   * X-Autoreply family, are the only trustworthy way to know a machine composed a message -
   * the wording alone cannot be relied on, and guessing from wording is how a real reply gets
   * filed as an autoresponder.
   */
  headers?: Record<string, string>;
}

export interface SyncResult {
  messages: ProviderMessage[];
  /** Opaque cursor to persist; passed back on the next sync for incremental fetch. */
  historyId?: string;
}

export interface MailProvider {
  readonly name: string;
  getAccount(): Promise<{ emailAddress: string; providerAccountId?: string }>;
  validateConnection(): Promise<{ ok: boolean; error?: string }>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  sendReply(input: SendMessageInput): Promise<SendMessageResult>;
  /** Incremental where the provider supports it. `since` is the persisted cursor. */
  syncMessages(since?: string | null): Promise<SyncResult>;
  getThread(threadId: string): Promise<ProviderMessage[]>;
  disconnect(): Promise<void>;
}

/** Shared MIME construction so Gmail and any future provider produce identical messages. */
export function buildMime(input: SendMessageInput, rfcMessageId: string): string {
  const boundary = `b_${Math.random().toString(36).slice(2)}`;
  const fromHeader = input.fromName ? `"${input.fromName}" <${input.from}>` : input.from;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: ${rfcMessageId}`,
    "MIME-Version: 1.0",
  ];
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);
  if (input.listUnsubscribe) {
    headers.push(`List-Unsubscribe: <${input.listUnsubscribe}>`);
    headers.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  }
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  return [
    headers.join("\r\n"), "", `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8", "", input.bodyText, "",
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", input.bodyHtml, "",
    `--${boundary}--`, "",
  ].join("\r\n");
}

export function newRfcMessageId(domain: string): string {
  return `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`;
}
