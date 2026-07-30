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
