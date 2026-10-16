import type { Mailbox } from "@prisma/client";
import { config } from "../config";
import { GmailProvider } from "./gmail";
import { MockMailProvider } from "./mock";
import type { MailProvider } from "./types";

/**
 * The only place a provider is instantiated. In mock mode this ALWAYS returns the mock,
 * regardless of what the mailbox row says - so a misconfigured mailbox cannot reach Gmail
 * while the application is in mock mode.
 */
export function providerFor(mailbox: Mailbox): MailProvider {
  if (config.emailMode !== "gmail") return new MockMailProvider(mailbox.emailAddress);
  if (mailbox.provider === "mock" || !mailbox.encryptedRefreshToken)
    return new MockMailProvider(mailbox.emailAddress);
  return new GmailProvider(mailbox.emailAddress, mailbox.encryptedRefreshToken);
}

export * from "./types";
