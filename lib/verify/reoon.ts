/**
 * Reoon bulk email verification.
 *
 * Two steps by design: submit a list and get a task id, then poll that task until it completes.
 * Nothing here interprets a result — mapping the provider's verdict onto the registry's own
 * statuses happens in one place, `mapResult`, so a change of provider touches one function.
 *
 * The API key never leaves the server: every call in this file runs server-side only.
 */
import { config } from "../config";

const BASE = "https://emailverifier.reoon.com/api/v1";

/** Reoon accepts up to 50,000 addresses in one task. */
export const MAX_PER_TASK = 50_000;

export type ReoonSubmission = {
  taskId: number;
  submitted: number;
  duplicatesRemoved: number;
  rejected: number;
  processing: number;
};

export type ReoonRecord = {
  email: string;
  status: string;
  is_deliverable?: boolean;
  is_safe_to_send?: boolean;
  is_catch_all?: boolean;
  is_disposable?: boolean;
  is_role_account?: boolean;
  is_spamtrap?: boolean | string;
  is_disabled?: boolean;
  has_inbox_full?: boolean;
  is_valid_syntax?: boolean;
  mx_accepts_mail?: boolean;
  can_connect_smtp?: boolean;
  domain?: string;
  mx_records?: string[];
};

export type ReoonTask = {
  taskId: string;
  name: string;
  /** waiting | running | completed | file_not_found | file_loading_error | … */
  status: string;
  total: number;
  checked: number;
  progress: number;
  results?: Record<string, ReoonRecord>;
};

export type ReoonBalance = {
  apiStatus: string;
  dailyCredits: number;
  instantCredits: number;
};

export class ReoonError extends Error {}

function requireKey(): string {
  const key = config.verifier.apiKey;
  if (!key) throw new ReoonError("no verifier API key is configured");
  return key;
}

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store" });
  } catch (e) {
    throw new ReoonError(`could not reach the verifier: ${(e as Error).message}`);
  }
  let body: Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    throw new ReoonError(`the verifier returned a non-JSON response (HTTP ${res.status})`);
  }
  if (body.status === "error" || (!res.ok && res.status !== 201))
    throw new ReoonError(String(body.reason ?? `verifier returned HTTP ${res.status}`));
  return body;
}

/** Step one: hand over the addresses and get a task id back. */
export async function createTask(name: string, emails: string[]): Promise<ReoonSubmission> {
  const key = requireKey();
  if (!emails.length) throw new ReoonError("no addresses to submit");
  if (emails.length > MAX_PER_TASK)
    throw new ReoonError(`${emails.length} addresses exceeds the ${MAX_PER_TASK} per-task limit`);

  const body = await call(`${BASE}/create-bulk-verification-task/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The provider caps the task name at 25 characters and rejects longer ones outright.
    body: JSON.stringify({ name: name.slice(0, 25), emails, key }),
  });

  const taskId = Number(body.task_id);
  if (!Number.isFinite(taskId)) throw new ReoonError("the verifier returned no task id");
  return {
    taskId,
    submitted: Number(body.count_submitted ?? emails.length),
    duplicatesRemoved: Number(body.count_duplicates_removed ?? 0),
    rejected: Number(body.count_rejected_emails ?? 0),
    processing: Number(body.count_processing ?? 0),
  };
}

/** Step two: ask how the task is doing, and take the results once it has finished. */
export async function getTask(taskId: string | number): Promise<ReoonTask> {
  const key = requireKey();
  // The provider's own documentation spells this parameter both ways - `task_id` in the URL
  // template and `task-id` in its Python sample. Sending both costs nothing and tolerates either.
  const url = `${BASE}/get-result-bulk-verification-task/` +
    `?key=${encodeURIComponent(key)}&task_id=${encodeURIComponent(String(taskId))}` +
    `&task-id=${encodeURIComponent(String(taskId))}`;

  const body = await call(url);
  return {
    taskId: String(body.task_id ?? taskId),
    name: String(body.name ?? ""),
    status: String(body.status ?? "unknown"),
    total: Number(body.count_total ?? 0),
    checked: Number(body.count_checked ?? 0),
    progress: Number(body.progress_percentage ?? 0),
    results: (body.results as Record<string, ReoonRecord> | undefined) ?? undefined,
  };
}

export async function getBalance(): Promise<ReoonBalance> {
  const key = requireKey();
  const body = await call(`${BASE}/check-account-balance/?key=${encodeURIComponent(key)}`);
  return {
    apiStatus: String(body.api_status ?? "unknown"),
    dailyCredits: Number(body.remaining_daily_credits ?? 0),
    instantCredits: Number(body.remaining_instant_credits ?? 0),
  };
}

export type MappedResult = {
  result: "VALID" | "INVALID" | "RISKY" | "CATCH_ALL" | "UNKNOWN";
  detail: string;
  /** True for the handful of outcomes where an address must never be mailed again. */
  suppress: boolean;
};

/**
 * The provider's verdict, mapped onto the registry's five statuses.
 *
 * Order matters and is deliberate:
 *
 *  - A spamtrap is suppressed outright. It is a working address whose only purpose is to catch
 *    senders, and one delivery to it can cost a domain its reputation for months.
 *  - A catch-all domain accepts everything, so a "deliverable" verdict there proves nothing about
 *    the mailbox. It is never counted as valid, which is exactly what the brief asks for.
 *  - Undeliverable is undeliverable, whatever the reason: disabled account, full inbox, no MX.
 *  - A role account that genuinely accepts mail is valid. It is flagged as shared elsewhere, and
 *    downgrading it here would throw away most of an independent pharmacy's published addresses.
 */
export function mapResult(r: ReoonRecord): MappedResult {
  const status = (r.status ?? "").toLowerCase();
  const flags: string[] = [];
  if (r.is_role_account) flags.push("role account");
  if (r.is_disposable) flags.push("disposable");
  if (r.has_inbox_full) flags.push("inbox full");
  if (r.is_disabled) flags.push("disabled");
  const note = (base: string) => flags.length ? `${base} · ${flags.join(", ")}` : base;

  // A spamtrap is truthy-but-not-"None" in the provider's payload.
  const spamtrap = r.is_spamtrap === true || r.is_spamtrap === "true";
  if (spamtrap)
    return { result: "INVALID", detail: note("spamtrap — never mail this address"), suppress: true };

  if (r.is_catch_all === true || status === "catch_all" || status === "catch-all")
    return { result: "CATCH_ALL",
             detail: note("catch-all domain — acceptance proves nothing"), suppress: false };

  if (status === "invalid" || r.is_deliverable === false || r.mx_accepts_mail === false
      || r.is_valid_syntax === false)
    return { result: "INVALID", detail: note(status || "undeliverable"), suppress: true };

  if (r.is_disabled === true || r.has_inbox_full === true)
    return { result: "INVALID", detail: note(status || "mailbox unavailable"), suppress: false };

  if (r.is_disposable === true)
    return { result: "RISKY", detail: note("disposable address"), suppress: false };

  if (status === "safe" || status === "valid" || r.is_safe_to_send === true
      || r.is_deliverable === true)
    return { result: "VALID", detail: note(status || "deliverable"), suppress: false };

  if (status === "unknown" || status === "")
    return { result: "UNKNOWN", detail: note("the verifier could not decide"), suppress: false };

  // An unfamiliar verdict is reported as risky rather than guessed into the campaign list.
  return { result: "RISKY", detail: note(`provider said "${status}"`), suppress: false };
}
