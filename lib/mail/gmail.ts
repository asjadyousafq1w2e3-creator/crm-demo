import { google, type gmail_v1 } from "googleapis";
import { config } from "../config";
import { decryptToken } from "../crypto";
import type {
  MailProvider, ProviderMessage, SendMessageInput, SendMessageResult, SyncResult,
} from "./types";
import { buildMime, newRfcMessageId } from "./types";

/** Minimum privilege: send, plus read for reply synchronisation. No modify, no full mailbox. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function oauthClient() {
  return new google.auth.OAuth2(
    config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

export function authUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",     // needed for a refresh token
    prompt: "consent",          // forces a refresh token even on re-consent
    scope: GMAIL_SCOPES,
    state,
  });
}

export type ConnectedAccount = {
  refreshToken: string;
  emailAddress: string;
  displayName?: string;
  providerAccountId?: string;
  missingScopes: string[];
};

/**
 * Exchange an OAuth code for tokens and identify the account. Kept here so that Gmail API
 * calls stay inside the mail layer - route handlers never talk to Google directly.
 */
export async function exchangeCodeForAccount(code: string): Promise<ConnectedAccount> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token)
    throw new Error("no_refresh_token");
  client.setCredentials(tokens);
  const me = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  if (!me.data.email) throw new Error("no_email");
  const granted = (tokens.scope ?? "").split(" ");
  return {
    refreshToken: tokens.refresh_token,
    emailAddress: me.data.email,
    displayName: me.data.name ?? undefined,
    providerAccountId: me.data.id ?? undefined,
    missingScopes: GMAIL_SCOPES.filter((s) => !granted.includes(s)),
  };
}

const b64url = (s: string) =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const BOUNCE_SENDERS = ["mailer-daemon", "postmaster"];

/** Per-part cap on stored message bodies. The provider keeps the original. */
const MAX_BODY_CHARS = 100_000;

export class GmailProvider implements MailProvider {
  readonly name = "gmail";
  private gmail;

  constructor(private address: string, encryptedRefreshToken: string) {
    const auth = oauthClient();
    // Only the refresh token is persisted; the access token is obtained per-use and never stored.
    auth.setCredentials({ refresh_token: decryptToken(encryptedRefreshToken) });
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async getAccount() {
    const res = await this.gmail.users.getProfile({ userId: "me" });
    return {
      emailAddress: res.data.emailAddress ?? this.address,
      providerAccountId: res.data.emailAddress ?? undefined,
    };
  }

  async validateConnection() {
    try { await this.gmail.users.getProfile({ userId: "me" }); return { ok: true }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }

  private async send(input: SendMessageInput): Promise<SendMessageResult> {
    const domain = this.address.split("@")[1] ?? "gmail.com";
    const rfcMessageId = newRfcMessageId(domain);
    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: b64url(buildMime(input, rfcMessageId)),
        ...(input.threadId ? { threadId: input.threadId } : {}),
      },
    });
    return {
      // A 200 from Gmail means ACCEPTED FOR DELIVERY, not delivered. Callers record SENT.
      providerMessageId: res.data.id!,
      providerThreadId: res.data.threadId!,
      rfcMessageId,
    };
  }

  async sendMessage(input: SendMessageInput) { return this.send(input); }
  async sendReply(input: SendMessageInput) { return this.send(input); }

  /** Incremental via the History API when a cursor exists; a bounded list otherwise. */
  async syncMessages(since?: string | null): Promise<SyncResult> {
    const ids: string[] = [];
    let historyId = since ?? undefined;

    if (since) {
      try {
        const res = await this.gmail.users.history.list({
          userId: "me", startHistoryId: since, historyTypes: ["messageAdded"], maxResults: 500,
        });
        for (const h of res.data.history ?? [])
          for (const m of h.messagesAdded ?? []) if (m.message?.id) ids.push(m.message.id);
        historyId = res.data.historyId ?? since;
      } catch {
        historyId = undefined;   // cursor expired; fall through to a bounded list
      }
    }
    if (!since || historyId === undefined) {
      const res = await this.gmail.users.messages.list({
        userId: "me", q: "in:inbox newer_than:7d", maxResults: 100,
      });
      for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
      const prof = await this.gmail.users.getProfile({ userId: "me" });
      historyId = prof.data.historyId ?? undefined;
    }

    const messages: ProviderMessage[] = [];
    for (const id of [...new Set(ids)]) {
      const msg = await this.fetch(id);
      if (msg) messages.push(msg);
    }
    return { messages, historyId };
  }

  async getThread(threadId: string): Promise<ProviderMessage[]> {
    const res = await this.gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    const out: ProviderMessage[] = [];
    for (const m of res.data.messages ?? []) {
      const parsed = this.parse(m);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  private async fetch(id: string): Promise<ProviderMessage | null> {
    try {
      const res = await this.gmail.users.messages.get({ userId: "me", id, format: "full" });
      return this.parse(res.data);
    } catch { return null; }
  }

  private parse(m: gmail_v1.Schema$Message): ProviderMessage | null {
    if (!m?.id) return null;
    const headers: Record<string, string> = {};
    for (const h of m.payload?.headers ?? [])
      headers[String(h.name).toLowerCase()] = h.value ?? "";

    let bodyText = "", bodyHtml = "";
    const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
      if (!part) return;
      // A reply can carry a very large quoted history, or an attachment encoded inline. Storing
      // it whole would be the only unbounded write in the system, so each side is capped; the
      // provider still holds the complete message.
      const data = part.body?.data;
      if (data && (bodyText.length < MAX_BODY_CHARS || bodyHtml.length < MAX_BODY_CHARS)) {
        const decoded = fromB64(data).toString("utf8");
        if (part.mimeType === "text/plain") bodyText += decoded;
        else if (part.mimeType === "text/html") bodyHtml += decoded;
      }
      for (const p of part.parts ?? []) walk(p);
    };
    walk(m.payload ?? undefined);

    const truncate = (v: string) =>
      v.length > MAX_BODY_CHARS ? `${v.slice(0, MAX_BODY_CHARS)}\n\n[truncated]` : v;
    bodyText = truncate(bodyText);
    bodyHtml = truncate(bodyHtml);

    const from = headers["from"] ?? "";
    const subject = headers["subject"] ?? "";
    // Conservative bounce detection - only obvious daemon traffic, never a guess from wording.
    const isBounce =
      BOUNCE_SENDERS.some((s) => from.toLowerCase().includes(s)) ||
      /delivery status notification|undelivered mail returned/i.test(subject);

    return {
      providerMessageId: m.id,
      providerThreadId: m.threadId ?? m.id,
      rfcMessageId: headers["message-id"],
      inReplyTo: headers["in-reply-to"],
      references: headers["references"],
      from, to: headers["to"] ?? "", cc: headers["cc"],
      subject, bodyText, bodyHtml,
      receivedAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
      isBounce,
      headers,
    };
  }

  async disconnect() { /* token row is deleted by the caller */ }
}
