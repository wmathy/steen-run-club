import { z } from "zod";

export const RUN_TYPES = [
  "easy",
  "tempo",
  "interval",
  "long",
  "race",
  "recovery",
  "other",
] as const;

export const WORKOUT_TYPES = [
  "easy",
  "tempo",
  "interval",
  "long",
  "race",
  "rest",
  "strength",
  "cross",
] as const;

/** True only for real calendar dates (rejects 2023-02-30, 2023-02-29 non-leap). */
export function isValidIsoCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [ys, ms, ds] = s.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  // Construct in UTC so local TZ cannot shift the day
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isValidIsoCalendarDate, "Invalid calendar date");

export const runTypeSchema = z.enum(RUN_TYPES);
export const workoutTypeSchema = z.enum(WORKOUT_TYPES);

const WORKOUT_TYPE_ALIASES: Record<string, (typeof WORKOUT_TYPES)[number]> = {
  recovery: "easy",
  warmup: "easy",
  warm_up: "easy",
  cooldown: "easy",
  cool_down: "easy",
  jog: "easy",
  base: "easy",
  aerobic: "easy",
  threshold: "tempo",
  cruise: "tempo",
  steady: "tempo",
  marathon_pace: "tempo",
  vo2: "interval",
  vo2max: "interval",
  vo2_max: "interval",
  track: "interval",
  speed: "interval",
  reps: "interval",
  hills: "interval",
  fartlek: "interval",
  strides: "interval",
  long_run: "long",
  time_trial: "race",
  "5k": "race",
  race_day: "race",
  off: "rest",
  recovery_day: "rest",
  lift: "strength",
  lifting: "strength",
  gym: "strength",
  mobility: "strength",
  core: "strength",
  bjj: "cross",
  bike: "cross",
  cycling: "cross",
  swim: "cross",
  cross_train: "cross",
  crosstrain: "cross",
  other: "cross",
};

/** null, undefined, and "" become undefined. Other strings are trimmed. */
export function blankToUndefined(
  value: string | null | undefined,
): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * YYYY-MM-DD, or the calendar day of an ISO timestamp.
 * Invalid optional dates return undefined so the tool can ignore them.
 */
export function canonicalIsoDate(
  value: string | null | undefined,
): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const day = trimmed.includes("T")
    ? trimmed.slice(0, trimmed.indexOf("T"))
    : trimmed;
  return isValidIsoCalendarDate(day) ? day : undefined;
}

/**
 * 0, negative, null, and non-finite values become undefined.
 * Rest and strength days often send 0. Values above 2000 are capped.
 */
export function normalizeOptionalMeasure(
  value: number | null | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value > 2000 ? 2000 : value;
}

export function normalizeWorkoutType(
  raw: string | null | undefined,
  distanceMiles: number | null | undefined,
): (typeof WORKOUT_TYPES)[number] {
  const key = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if ((WORKOUT_TYPES as readonly string[]).includes(key)) {
    return key as (typeof WORKOUT_TYPES)[number];
  }
  const alias = WORKOUT_TYPE_ALIASES[key];
  if (alias) return alias;
  return typeof distanceMiles === "number" &&
    Number.isFinite(distanceMiles) &&
    distanceMiles > 0
    ? "easy"
    : "rest";
}

/** 0 = Monday … 6 = Sunday. */
export function planWeekdayIndex(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Accept 7 as Sunday. Out-of-range values use the workout date when it
 * is a real calendar day, otherwise clamp into Monday–Sunday.
 */
export function normalizePlanDayOfWeek(
  value: number | null | undefined,
  isoDate?: string | null,
): number | undefined {
  const date =
    isoDate && isValidIsoCalendarDate(isoDate) ? isoDate : undefined;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
  ) {
    return value;
  }
  if (value === 7) return date ? planWeekdayIndex(date) : 6;
  if (date) return planWeekdayIndex(date);
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value > 7) return 6;
    if (value < 0) return 0;
  }
  return undefined;
}

export const createRunSchema = z.object({
  date: z
    .string()
    .min(1)
    .transform((s) => (s.includes("T") ? s.slice(0, 10) : s))
    .pipe(isoDateSchema),
  distanceMiles: z.number().finite().positive().max(300),
  durationMin: z.number().finite().positive().max(24 * 60).optional(),
  type: runTypeSchema,
  notes: z.string().max(4000).optional(),
  perceivedEffort: z.number().int().min(1).max(10).optional(),
});

export type CreateRunInput = z.infer<typeof createRunSchema>;

const PROFILE_FIELD_MAX = 4000;

export const coachingStyleSchema = z.enum([
  "concise",
  "balanced",
  "detailed",
  "motivational",
  "goggins",
]);

export const coachProfileUpdateSchema = z.object({
  summary: z.string().max(PROFILE_FIELD_MAX).optional(),
  goals: z.string().max(PROFILE_FIELD_MAX).optional(),
  injuries: z.string().max(PROFILE_FIELD_MAX).optional(),
  preferences: z.string().max(PROFILE_FIELD_MAX).optional(),
  raceCalendar: z.string().max(PROFILE_FIELD_MAX).optional(),
  fitnessLevel: z.string().max(PROFILE_FIELD_MAX).optional(),
  schedule: z.string().max(PROFILE_FIELD_MAX).optional(),
  coachingStyle: coachingStyleSchema.optional(),
  includeStrength: z.boolean().optional(),
});

export const MAX_PLAN_WEEKS = 26;
export const MAX_WORKOUTS_PER_WEEK = 14;
export const MAX_CHAT_MESSAGES = 100;
export const MAX_CHAT_TEXT_CHARS = 16_000;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export function clampLimit(
  raw: string | null,
  defaultValue = 50,
  min = 1,
  max = 200,
): number {
  if (raw == null || raw === "") return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(max, Math.max(min, n));
}

export function parseIsoDateAtNoon(date: string): Date {
  const normalized = date.includes("T") ? date.slice(0, 10) : date;
  if (!isValidIsoCalendarDate(normalized)) {
    throw new Error("Invalid date");
  }
  // Store as UTC noon so the calendar day is stable across timezones
  const [y, m, d] = normalized.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
