import type {
  MailProvider, ProviderMessage, SendMessageInput, SendMessageResult, SyncResult,
} from "./types";
import { buildMime, newRfcMessageId } from "./types";

/**
 * Mock provider. Exercises the entire campaign pipeline - routing, queueing, scheduling,
 * threading - without contacting any external service. This is the default in development.
 *
 * It still builds the real MIME payload, so a MIME bug surfaces in mock rather than in production.
 */
export class MockMailProvider implements MailProvider {
  readonly name = "mock";
  constructor(private address: string) {}

  async getAccount() {
    return { emailAddress: this.address, providerAccountId: `mock-${this.address}` };
  }

  async validateConnection() {
    return { ok: true };
  }

  private fabricate(input: SendMessageInput): SendMessageResult {
    const domain = this.address.split("@")[1] ?? "localhost";
    const rfcMessageId = newRfcMessageId(domain);
    buildMime(input, rfcMessageId); // build it so MIME errors surface here too
    const id = `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      providerMessageId: id,
      providerThreadId: input.threadId ?? `mock-thread-${id}`,
      rfcMessageId,
    };
  }

  async sendMessage(input: SendMessageInput) { return this.fabricate(input); }
  async sendReply(input: SendMessageInput) { return this.fabricate(input); }

  /** Mock inbound traffic is created explicitly through the simulation actions, never invented. */
  async syncMessages(): Promise<SyncResult> { return { messages: [] }; }
  async getThread(): Promise<ProviderMessage[]> { return []; }
  async disconnect() { /* nothing to revoke */ }
}
