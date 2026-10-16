/**
 * Timezone-aware scheduling. The campaign's own timezone governs - never the server's,
 * never the browser's. A US campaign scheduled 9-4 Eastern must behave identically whether
 * the worker runs in Karachi, Frankfurt or Ohio.
 */
export type Window = {
  timezone: string;
  sendingDays: string;      // ISO weekday numbers, "1,2,3,4,5" = Mon-Fri
  sendingStartTime: string; // "09:00"
  sendingEndTime: string;   // "16:00"
};

/**
 * Is this a timezone the runtime actually knows?
 *
 * Intl throws a RangeError on an unknown zone, and a campaign row carrying a typo would otherwise
 * take the worker's tick down on every pass. Validated on the way in, and guarded again here.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "09:00" and nothing else - the value is compared as minutes past midnight. */
export function isValidTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** ISO weekday numbers, e.g. "1,2,3,4,5". At least one, none repeated out of range. */
export function isValidSendingDays(value: string): boolean {
  const parts = value.split(",").map((d) => d.trim());
  return parts.length > 0 && parts.every((d) => /^[1-7]$/.test(d));
}

export const FALLBACK_TIMEZONE = "UTC";

/** Wall-clock time in a given IANA zone, independent of the host's own timezone. */
export function zonedParts(at: Date, timeZone: string) {
  // Falling back to UTC keeps the worker running on a bad row; the window then simply reads in
  // UTC rather than the intended zone, which is visible and recoverable. Throwing here would
  // stop every campaign, not just the misconfigured one.
  const zone = isValidTimezone(timeZone) ? timeZone : FALLBACK_TIMEZONE;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    isoWeekday: weekdayMap[parts.weekday as string] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export type WindowVerdict =
  | { open: true }
  | { open: false; reason: "WRONG_DAY" | "BEFORE_WINDOW" | "AFTER_WINDOW" };

export function windowStatus(w: Window, at: Date = new Date()): WindowVerdict {
  const { isoWeekday, minutes } = zonedParts(at, w.timezone);
  // A malformed window must never read as "open all day" - fail closed.
  if (!isValidTimeOfDay(w.sendingStartTime) || !isValidTimeOfDay(w.sendingEndTime))
    return { open: false, reason: "AFTER_WINDOW" };
  const days = w.sendingDays.split(",").map((d) => Number(d.trim())).filter(Boolean);
  if (!days.includes(isoWeekday)) return { open: false, reason: "WRONG_DAY" };
  const start = toMinutes(w.sendingStartTime);
  const end = toMinutes(w.sendingEndTime);
  if (minutes < start) return { open: false, reason: "BEFORE_WINDOW" };
  if (minutes >= end) return { open: false, reason: "AFTER_WINDOW" };
  return { open: true };
}

/** The campaign's local calendar date, used to reset daily counters at local midnight. */
export function localDate(timezone: string, at: Date = new Date()): string {
  return zonedParts(at, timezone).date;
}

export function withinDateRange(start: Date | null, end: Date | null, at: Date = new Date()) {
  if (start && at < start) return false;
  if (end && at > end) return false;
  return true;
}
