import crypto from "node:crypto";
import { config, signingSecret } from "./config";

/**
 * AES-256-GCM for refresh tokens at rest. The key never reaches the browser - every caller
 * of these functions runs server-side only.
 */
const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = config.tokenEncryptionKey;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "utf8");
  if (buf.length !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return buf;
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptToken(payload: string): string {
  const [iv, tag, data] = payload.split(":");
  if (!iv || !tag || !data) throw new Error("malformed encrypted token");
  const d = crypto.createDecipheriv(ALGO, key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** Signed, non-guessable unsubscribe token. Never exposes a sequential database id. */
export function signUnsubscribeToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ e: email.toLowerCase(), t: Date.now() }))
    .toString("base64url");
  const sig = crypto.createHmac("sha256", signingSecret())
    .update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", signingSecret())
    .update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()).e as string; }
  catch { return null; }
}
