/**
 * Authoritative calendar clock for the coach (and any server logic that
 * needs "today" in the athlete's timezone, not Vercel UTC).
 */

/** Default when the client does not send a timezone (US-centric club). */
export const DEFAULT_COACH_TIME_ZONE = "America/New_York";

const WEEKDAY_TO_PLAN_DOW: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const PLAN_DOW_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type CoachClock = {
  timeZone: string;
  /** YYYY-MM-DD in athlete timezone */
  isoDate: string;
  /** e.g. Wednesday */
  weekday: string;
  /** plan dayOfWeek: 0=Monday … 6=Sunday */
  planDayOfWeek: number;
  /** Human line: Wednesday, July 29, 2026 */
  longDate: string;
  /** e.g. 3:42 PM EDT */
  localTime: string;
  /** Yesterday YYYY-MM-DD */
  yesterdayIso: string;
  yesterdayWeekday: string;
  /** Tomorrow YYYY-MM-DD */
  tomorrowIso: string;
  tomorrowWeekday: string;
};

/** Validate IANA timezone; fall back to US Eastern if missing/invalid. */
export function resolveTimeZone(input?: string | null): string {
  const raw = (input || "").trim();
  if (!raw || raw.length > 80 || !/^[A-Za-z0-9_+\-/]+$/.test(raw)) {
    return DEFAULT_COACH_TIME_ZONE;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return DEFAULT_COACH_TIME_ZONE;
  }
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function weekdayFromIso(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // UTC noon weekday matches calendar date for any ISO date string
  return PLAN_DOW_FULL[utc.getUTCDay() === 0 ? 6 : utc.getUTCDay() - 1];
}

/**
 * Current wall-clock for coaching: calendar day in the athlete's timezone.
 */
export function getCoachClock(timeZone?: string | null, now = new Date()): CoachClock {
  const tz = resolveTimeZone(timeZone);

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = part(dateParts, "year");
  const month = part(dateParts, "month");
  const day = part(dateParts, "day");
  const weekdayShort = part(dateParts, "weekday"); // Mon, Tue, …
  const isoDate = `${year}-${month}-${day}`;

  const planDayOfWeek = WEEKDAY_TO_PLAN_DOW[weekdayShort] ?? 0;
  const weekday = PLAN_DOW_FULL[planDayOfWeek];

  const longDate = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(now);

  const yesterdayIso = shiftIsoDate(isoDate, -1);
  const tomorrowIso = shiftIsoDate(isoDate, 1);

  return {
    timeZone: tz,
    isoDate,
    weekday,
    planDayOfWeek,
    longDate,
    localTime,
    yesterdayIso,
    yesterdayWeekday: weekdayFromIso(yesterdayIso),
    tomorrowIso,
    tomorrowWeekday: weekdayFromIso(tomorrowIso),
  };
}

/** Prompt block the model must treat as ground truth. */
export function formatCoachClockBlock(clock: CoachClock): string {
  return `## Current date & time (authoritative — never guess or invent a different day)
- Right now: ${clock.longDate}, ${clock.localTime}
- Today's calendar date: **${clock.isoDate}** (${clock.weekday})
- Plan dayOfWeek index for today: **${clock.planDayOfWeek}** (0=Monday … 6=Sunday)
- Athlete timezone: ${clock.timeZone}
- Yesterday: ${clock.yesterdayIso} (${clock.yesterdayWeekday})
- Tomorrow: ${clock.tomorrowIso} (${clock.tomorrowWeekday})

When the athlete says "today", "tonight", "tomorrow", "this week", or "what day is it", use these values only.
Chat history may mention older days — those are past, not "today".
When logging a run without a date, use ${clock.isoDate}.
When talking about the training plan for "today", use dayOfWeek ${clock.planDayOfWeek} (${clock.weekday}).`;
}
