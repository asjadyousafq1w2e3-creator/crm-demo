/** Central environment access. Nothing else in the app reads process.env directly. */
import { isCrmShowcase } from "./showcase-mode";
const showcase = isCrmShowcase();
const bool = (v: string | undefined, d = false) =>
  v === undefined ? d : ["1", "true", "yes", "on"].includes(v.toLowerCase());
const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

/**
 * The one public address of this deployment, e.g. https://crm.example.com.
 *
 * Every absolute URL the application puts in front of the outside world - unsubscribe links in
 * real email, the OAuth redirect, a redirect after login - is built from this and never from the
 * request's Host header. A Host header is supplied by whoever is calling; behind a proxy it can
 * be anything, and a link in an outgoing email built from a forged one would point wherever the
 * forger chose. Trailing slash is stripped once here so nothing downstream has to think about it.
 */
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");

export const config = {
  appUrl: APP_URL,

  admin: {
    email: process.env.ADMIN_EMAIL ?? "",
    passwordHash: process.env.ADMIN_PASSWORD_HASH ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
  },

  google: {
    clientId: showcase ? "" : process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: showcase ? "" : process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: showcase ? "" : process.env.GOOGLE_REDIRECT_URI ?? "",
  },

  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",

  /**
   * Where uploaded source files are kept. The original file is the only true record of what a
   * source supplied, so it is retained rather than discarded after parsing. In a container this
   * needs a volume, or the files go when the container does.
   */
  importStorageDir: process.env.IMPORT_STORAGE_DIR ?? "./storage/imports",

  /**
   * Email verification. With no key the flow is a CSV exchange - export the batch, run it through
   * any verifier, paste the results back. Setting a key lets the same batch run automatically;
   * nothing downstream changes either way, and no result is ever invented.
   */
  verifier: {
    provider: process.env.EMAIL_VERIFIER_PROVIDER ?? "reoon",
    // REOON_API_KEY is read first so the provider's own name is the obvious thing to set.
    apiKey: showcase ? "" : process.env.REOON_API_KEY ?? process.env.EMAIL_VERIFIER_API_KEY ?? "",
  },

  /**
   * Break-glass access, kept deliberately unremarkable in the environment.
   *
   * Only a scrypt hash is stored, exactly like the operator passwords: a leaked .env or a
   * container dump gives away nothing usable. The names say nothing about what the account is
   * for - though that is a courtesy, not a control. What actually protects it is the hash and
   * the permission check.
   */
  platform: {
    id: (process.env.PLATFORM_KEY_ID ?? "").trim().toLowerCase(),
    hash: process.env.PLATFORM_KEY_HASH ?? "",
    /** Unlinked path for the maintenance console. Secret paths are a convenience, not security. */
    consolePath: process.env.PLATFORM_CONSOLE_PATH ?? "ops-console",
  },

  /** mock = nothing leaves the process. gmail = real API, but see liveSendingEnabled. */
  emailMode: (showcase ? "mock" : process.env.EMAIL_MODE ?? "mock") as "mock" | "gmail",
  /** Real sending requires BOTH this AND emailMode === "gmail". Defaults to off. */
  liveSendingEnabled: !showcase && bool(process.env.ENABLE_LIVE_EMAIL_SENDING, false),
  /** When live, only these addresses may be sent to. Empty = nothing may be sent. */
  liveTestAllowlist: (process.env.LIVE_EMAIL_TEST_ALLOWLIST ?? "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),

  limits: {
    defaultMailboxDaily: num(process.env.DEFAULT_MAILBOX_DAILY_LIMIT, 20),
    globalDaily: num(process.env.GLOBAL_DAILY_LIMIT, 200),
    minDelaySeconds: num(process.env.MIN_DELAY_SECONDS, 45),
    maxDelaySeconds: num(process.env.MAX_DELAY_SECONDS, 120),
  },

  retry: {
    /** How many times one recipient may be attempted before it is left FAILED for good. */
    maxAttempts: num(process.env.MAX_SEND_ATTEMPTS, 3),
    /** First retry delay; doubles per attempt. */
    backoffMinutes: num(process.env.RETRY_BACKOFF_MINUTES, 5),
    /** A claim held longer than this means the worker died mid-send; the row is reclaimed. */
    claimTimeoutMinutes: num(process.env.SEND_CLAIM_TIMEOUT_MINUTES, 10),
  },

  /** Ramp stages cap volume. This is an operational control, not a reputation score. */
  rampLimits: {
    NEW: num(process.env.RAMP_NEW_LIMIT, 20),
    RAMPING: num(process.env.RAMP_RAMPING_LIMIT, 40),
    ESTABLISHED: num(process.env.RAMP_ESTABLISHED_LIMIT, 100),
    MANUAL: 0, // MANUAL means "use the mailbox's own dailyLimit verbatim"
  } as Record<string, number>,

  autoPause: {
    /**
     * Bounce rate that pauses a mailbox, as a percentage.
     *
     * Two, not five. Reputation damage begins around 2% and blacklisting risk around 5%, so a
     * brake set at 5 only engages once the harm is done - it protects against the catastrophe
     * and not against the thing that actually costs inbox placement. Two is early enough to stop
     * a bad list before it teaches receivers to distrust the domain.
     */
    bounceRateThreshold: num(process.env.BOUNCE_RATE_PAUSE_THRESHOLD, 2), // percent
    minSendsBeforeBounceCheck: num(process.env.BOUNCE_CHECK_MIN_SENDS, 20),
    consecutiveFailuresThreshold: num(process.env.CONSECUTIVE_FAILURE_THRESHOLD, 5),
  },

  schedule: {
    timezone: process.env.DEFAULT_TIMEZONE ?? "America/New_York",
    start: process.env.DEFAULT_SENDING_START ?? "09:00",
    end: process.env.DEFAULT_SENDING_END ?? "16:00",
  },

  company: {
    name: process.env.COMPANY_NAME ?? "",
    address: process.env.COMPANY_ADDRESS ?? "",
    website: process.env.COMPANY_WEBSITE ?? "",
  },
};

export type ConfigProblem = { key: string; message: string; fatal: boolean };

/**
 * Checks the environment as a whole rather than letting each value fail at its first use.
 *
 * A deployment missing SESSION_SECRET used to start happily and then break at the first login;
 * a missing APP_URL used to put http://localhost into unsubscribe links in real email. Both are
 * the kind of thing that should stop a release, not surface as a support ticket.
 */
export function checkConfig(): ConfigProblem[] {
  if (showcase) return [];
  const problems: ConfigProblem[] = [];
  const prod = process.env.NODE_ENV === "production";

  if (!config.admin.sessionSecret)
    problems.push({ key: "SESSION_SECRET", fatal: true,
      message: "not set - sessions and unsubscribe tokens cannot be signed. openssl rand -hex 32" });
  else if (config.admin.sessionSecret.length < 32)
    problems.push({ key: "SESSION_SECRET", fatal: prod,
      message: "shorter than 32 characters - generate a real one with openssl rand -hex 32" });

  if (!config.tokenEncryptionKey)
    problems.push({ key: "TOKEN_ENCRYPTION_KEY", fatal: config.emailMode === "gmail",
      message: "not set - Gmail refresh tokens cannot be encrypted. openssl rand -hex 32" });
  else if (!/^[0-9a-f]{64}$/i.test(config.tokenEncryptionKey) &&
           Buffer.from(config.tokenEncryptionKey, "utf8").length !== 32)
    problems.push({ key: "TOKEN_ENCRYPTION_KEY", fatal: true,
      message: "must be 32 bytes (64 hex characters)" });

  if (!config.admin.email || !config.admin.passwordHash)
    problems.push({ key: "ADMIN_EMAIL / ADMIN_PASSWORD_HASH", fatal: false,
      message: "not set - the first owner cannot be seeded on an empty database" });
  else if (!/^scrypt[:$]/.test(config.admin.passwordHash))
    problems.push({ key: "ADMIN_PASSWORD_HASH", fatal: false,
      message: 'not a scrypt hash - note that .env expands $VAR, so use the colon form from '
             + "npm run hash:password" });

  if (prod && config.appUrl.includes("localhost"))
    problems.push({ key: "APP_URL", fatal: true,
      message: "still points at localhost - unsubscribe links in real email would be unreachable" });
  if (!/^https?:\/\//.test(config.appUrl))
    problems.push({ key: "APP_URL", fatal: true, message: "must be an absolute http(s) URL" });
  else if (!appHost())
    problems.push({ key: "APP_URL", fatal: true, message: `is not a parseable URL: ${config.appUrl}` });
  // A production CRM carries session cookies and business contact data; plain HTTP puts both on
  // the wire. Secure cookies are not sent over HTTP either, so http:// in production does not
  // degrade gracefully - it fails to log anyone in.
  else if (prod && config.appUrl.startsWith("http://"))
    problems.push({ key: "APP_URL", fatal: true,
      message: "must be https:// in production - session cookies are Secure and will not be sent "
             + "over plain HTTP, so sign-in fails outright" });

  if (config.emailMode === "gmail") {
    for (const [key, value] of [["GOOGLE_CLIENT_ID", config.google.clientId],
                                ["GOOGLE_CLIENT_SECRET", config.google.clientSecret],
                                ["GOOGLE_REDIRECT_URI", config.google.redirectUri]] as const) {
      if (!value) problems.push({ key, fatal: true, message: "required when EMAIL_MODE=gmail" });
    }
    if (config.google.redirectUri &&
        !config.google.redirectUri.startsWith(config.appUrl.replace(/\/$/, "")))
      problems.push({ key: "GOOGLE_REDIRECT_URI", fatal: false,
        message: `does not sit under APP_URL (${config.appUrl}) - OAuth will fail on callback` });
  }

  if (config.platform.id && config.platform.id === config.admin.email)
    problems.push({ key: "PLATFORM_KEY_ID", fatal: false,
      message: "is the same address as ADMIN_EMAIL - the two accounts need different addresses, "
             + "and break-glass access stays disabled until they do" });
  if (config.platform.id && !config.platform.hash)
    problems.push({ key: "PLATFORM_KEY_HASH", fatal: false,
      message: "set without a matching hash - break-glass access will not work" });
  if (config.platform.hash && !/^scrypt[:$]/.test(config.platform.hash))
    problems.push({ key: "PLATFORM_KEY_HASH", fatal: false,
      message: "not a scrypt hash - generate it with npm run hash:password" });

  if (config.liveSendingEnabled && !config.liveTestAllowlist.length)
    problems.push({ key: "LIVE_EMAIL_TEST_ALLOWLIST", fatal: false,
      message: "empty while live sending is enabled - every address will be refused" });

  if (config.limits.globalDaily < config.limits.defaultMailboxDaily)
    problems.push({ key: "GLOBAL_DAILY_LIMIT", fatal: false,
      message: "lower than DEFAULT_MAILBOX_DAILY_LIMIT - a single mailbox can never reach its cap" });

  return problems;
}

/** Throws on anything that makes the process unsafe to run. Called once at worker startup. */
export function assertConfig(): void {
  const fatal = checkConfig().filter((p) => p.fatal);
  if (!fatal.length) return;
  throw new Error("Configuration is not usable:\n" +
    fatal.map((p) => `  - ${p.key}: ${p.message}`).join("\n"));
}

/**
 * The HMAC key behind session cookies and unsubscribe tokens. Refusing to fall back to a
 * constant is deliberate: a predictable key would let anyone mint a session or forge an
 * unsubscribe, and a silent default is exactly the kind of thing that survives to production.
 */
export function signingSecret(): string {
  if (!config.admin.sessionSecret)
    throw new Error("SESSION_SECRET is not set - generate one with: openssl rand -hex 32");
  return config.admin.sessionSecret;
}

/**
 * Where the deployment lives, parsed once. Returns null only if APP_URL is unparseable, which
 * checkConfig reports as fatal - callers therefore fall back to the raw string rather than crash.
 */
function appUrlParts(): URL | null {
  try { return new URL(config.appUrl); } catch { return null; }
}

/** Scheme + host of this deployment: "https://crm.example.com". */
export function appOrigin(): string {
  return appUrlParts()?.origin ?? config.appUrl;
}

/** Host of this deployment, port included when there is one: "crm.example.com". */
export function appHost(): string {
  return appUrlParts()?.host ?? "";
}

/**
 * A redirect to a path inside this application.
 *
 * The Location header is deliberately relative. Three things follow from that, and all three are
 * what we want:
 *
 *   - It cannot be steered anywhere. There is no host in the header for a forged Host header to
 *     influence, which is the same protection absoluteUrl() gives, arrived at by removing the
 *     attack surface rather than by overriding it.
 *   - It always resolves to whatever origin actually served the page, so the application works on
 *     any port or hostname without APP_URL having to agree.
 *   - It satisfies the Content-Security-Policy `form-action 'self'` by construction. A browser
 *     applies form-action across redirects, so an absolute redirect to a different origin after
 *     a form POST is blocked - which is how a correct APP_URL stopped being merely tidy and
 *     started being the difference between being able to sign in and not.
 *
 * Callers must pass a path, not a URL. safeNextPath() is what guarantees that for anything that
 * came from a request.
 */
export function redirectTo(path: string, status: 303 | 307 = 303): Response {
  const location = path.startsWith("/") ? path : `/${path}`;
  return new Response(null, { status, headers: { Location: location } });
}

/**
 * An absolute URL for a path in this application.
 *
 * Use this for anything that leaves the process or steers a browser - email bodies, OAuth
 * redirects, post-login redirects. Resolving a path against the incoming request instead would
 * let a forged Host header decide where the link points.
 */
export function absoluteUrl(path: string): string {
  return new URL(path, `${appOrigin()}/`).toString();
}

/**
 * Whether a request came from this deployment's own origin.
 *
 * Defence in depth for state-changing route handlers. The session cookie is SameSite=Lax, so a
 * browser will not attach it to a cross-site POST in the first place and CSRF is already blocked;
 * this is the second lock, and it is what makes an Origin mismatch visible rather than silent.
 * A request with no Origin and no Referer is allowed through: non-browser callers (a container
 * health probe, curl during a deploy) send neither, and they carry no ambient cookie either.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const expected = appOrigin();
  if (origin) return origin === expected;
  const referer = headers.get("referer");
  if (referer) {
    try { return new URL(referer).origin === expected; } catch { return false; }
  }
  return true;
}

/** The single place that decides whether a real message may leave the application. */
export function liveSendingAllowed(): { allowed: boolean; reason: string } {
  if (config.emailMode !== "gmail")
    return { allowed: false, reason: `EMAIL_MODE is "${config.emailMode}", not "gmail"` };
  if (!config.liveSendingEnabled)
    return { allowed: false, reason: "ENABLE_LIVE_EMAIL_SENDING is not true" };
  return { allowed: true, reason: "" };
}

/** Even when live, an address must be on the allowlist. An empty allowlist blocks everything. */
export function liveRecipientAllowed(email: string): boolean {
  return config.liveTestAllowlist.includes(email.trim().toLowerCase());
}
