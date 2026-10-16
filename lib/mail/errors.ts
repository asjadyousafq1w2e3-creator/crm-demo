/**
 * Classifying provider failures.
 *
 * The difference that matters operationally is "this mailbox needs a human" versus "try again
 * later". A revoked or expired refresh token never fixes itself, so leaving that mailbox in a
 * warning state means it silently fails every tick until somebody notices; it should be taken out
 * of rotation and flagged for reconnection instead.
 */
export type FailureKind = "AUTH" | "RATE_LIMIT" | "TRANSIENT" | "PERMANENT";

const AUTH = /invalid_grant|invalid_credentials|unauthorized|401|token has been (expired|revoked)/i;
const RATE = /rate ?limit|too many requests|429|quota|user-rate|backend error/i;
const TRANSIENT = /timeout|socket|econn|enotfound|network|503|502|504|temporar/i;

export function classifyFailure(message: string): FailureKind {
  if (AUTH.test(message)) return "AUTH";
  if (RATE.test(message)) return "RATE_LIMIT";
  if (TRANSIENT.test(message)) return "TRANSIENT";
  return "PERMANENT";
}

/** What the mailbox row should say after a failure of this kind. */
export function mailboxStateFor(kind: FailureKind): { status: string; healthStatus: string } {
  switch (kind) {
    // Out of rotation and clearly labelled: the router refuses anything but CONNECTED.
    case "AUTH": return { status: "ERROR", healthStatus: "UNHEALTHY" };
    case "RATE_LIMIT": return { status: "WARNING", healthStatus: "UNKNOWN" };
    case "TRANSIENT": return { status: "WARNING", healthStatus: "UNKNOWN" };
    default: return { status: "WARNING", healthStatus: "UNKNOWN" };
  }
}

export function explainFailure(kind: FailureKind): string {
  switch (kind) {
    case "AUTH": return "the connection was rejected - reconnect this mailbox";
    case "RATE_LIMIT": return "the provider is rate limiting this account";
    case "TRANSIENT": return "a temporary network or provider problem";
    default: return "the provider rejected the request";
  }
}
