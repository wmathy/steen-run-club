import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCoachClock } from "@/lib/clock";
import {
  createEventsFromWorkouts,
  isGoogleConfigured,
} from "@/lib/google-calendar";
import { handlePlanSave, handlePlanScheduleEdit } from "@/lib/plan-actions";
import type { PlanWorkoutDraft, PlanWeekDraft } from "@/lib/plan-model";
import { workoutIsoDate, clampRaceTaperDays, type NormalizedPlan } from "@/lib/plan-rules";
import {
  activePlanRunningMiles,
  createPrismaPlanRepository,
} from "@/lib/plan-repository";
import {
  coercePlanWriteReason,
  type PlanWriteMode,
  type PlanWriteReason,
} from "@/lib/plan-policy";
import type { ScheduleOperation } from "@/lib/plan-edit";
import {
  blankToUndefined,
  canonicalIsoDate,
  MAX_PLAN_WEEKS,
  MAX_WORKOUTS_PER_WEEK,
  normalizeOptionalMeasure,
  normalizePlanDayOfWeek,
  normalizeWorkoutType,
  parseIsoDateAtNoon,
  runTypeSchema,
} from "@/lib/validation";

const PROFILE_MAX = 4000;
const MAX_INACTIVE_PLANS = 10;

export const SAVE_PLAN_WEEKS_REQUIRED =
  "You must include the non-empty `weeks` array containing each week and its `workouts` in the same `save_or_update_plan` call.";

const looseText = (max: number) => z.string().max(max).nullish();
/** 0, negative, and null are allowed here so execute() can normalize them. */
const looseMeasure = z.number().finite().max(2000).nullish();
const looseDayOfWeek = z
  .number()
  .int()
  .nullish()
  .describe("0=Monday … 6=Sunday. 7 is accepted as Sunday.");

const workoutInputSchema = z.object({
  dayOfWeek: looseDayOfWeek,
  date: z
    .string()
    .nullish()
    .describe(
      "YYYY-MM-DD for this slot. A time suffix such as T00:00:00Z is stripped. Set this on race day to raceDate. A valid date is kept even if dayOfWeek is off.",
    ),
  type: z
    .string()
    .nullish()
    .describe("One of: easy, tempo, interval, long, race, rest, strength, cross"),
  title: z.string().min(1).max(200),
  description: looseText(4000).describe(
    "1-2 sentences: warm-up, main set, cool-down, and effort. Strength: one short sets×reps line per exercise. Keep it short so 10 weeks fit in one call.",
  ),
  distanceMiles: looseMeasure.describe(
    "Distance in miles. 0 or null for strength/rest is fine.",
  ),
  durationMin: looseMeasure.describe(
    "Duration in minutes. 0 or null for rest is fine. Strength sessions should be 30–45.",
  ),
  targetPace: looseText(80).describe(
    'Suggested pace as min/mi for runs, e.g. "9:30/mi". Omit for strength/rest.',
  ),
});

const weekInputSchema = z.object({
  weekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
  focus: looseText(500),
  notes: looseText(2000),
  workouts: z.array(workoutInputSchema).max(MAX_WORKOUTS_PER_WEEK).nullish(),
});

const dayRefSchema = z.object({
  weekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
  dayOfWeek: looseDayOfWeek,
});

export type SavedPlanRecord = {
  id: string;
  title: string;
  weeks: Array<{ workouts: Array<unknown> }>;
};

export function normalizeSavePlanToolInput(input: {
  title?: string | null;
  goal?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  raceDate?: string | null;
  taperDays?: number | null;
  reason?: string | null;
  notes?: string | null;
  replaceActive?: boolean | null;
  weeks?: Array<{
    weekNumber: number;
    focus?: string | null;
    notes?: string | null;
    workouts?: Array<{
      dayOfWeek?: number | null;
      date?: string | null;
      type?: string | null;
      title?: string | null;
      description?: string | null;
      distanceMiles?: number | null;
      durationMin?: number | null;
      targetPace?: string | null;
    }> | null;
  }> | null;
}):
  | {
      ok: true;
      reason: PlanWriteReason;
      replaceActive: boolean;
      draft: {
        title: string;
        goal: string | null;
        startDate: string;
        endDate: string | null;
        notes: string | null;
        raceDate: string | null;
        taperDays: number | null;
        weeks: PlanWeekDraft[];
      };
    }
  | { ok: false; error: string } {
  const title = blankToUndefined(input.title ?? undefined);
  if (!title) return { ok: false, error: "Plan title is required." };

  const startDate = canonicalIsoDate(input.startDate);
  if (!startDate) {
    return {
      ok: false,
      error: "startDate must be a real calendar day as YYYY-MM-DD.",
    };
  }
  if (!input.weeks || input.weeks.length === 0) {
    return { ok: false, error: SAVE_PLAN_WEEKS_REQUIRED };
  }

  const weeks: PlanWeekDraft[] = [];
  let hasRaceWorkout = false;
  for (const week of input.weeks) {
    const workouts: PlanWorkoutDraft[] = [];
    for (const workout of week.workouts ?? []) {
      const workoutTitle = blankToUndefined(workout.title ?? undefined);
      if (!workoutTitle) {
        return {
          ok: false,
          error: `Week ${week.weekNumber} has a workout without a title.`,
        };
      }
      const date = canonicalIsoDate(workout.date);
      const dayOfWeek = normalizePlanDayOfWeek(workout.dayOfWeek, date);
      if (dayOfWeek == null) {
        return {
          ok: false,
          error: `Workout "${workoutTitle}" needs a dayOfWeek from 0 (Monday) through 6 (Sunday).`,
        };
      }
      const type = normalizeWorkoutType(workout.type, workout.distanceMiles);
      if (type === "race") hasRaceWorkout = true;
      workouts.push({
        dayOfWeek,
        date: date ?? null,
        type,
        title: workoutTitle.slice(0, 200),
        description: blankToUndefined(workout.description)?.slice(0, 4000) ?? null,
        distanceMiles: normalizeOptionalMeasure(workout.distanceMiles) ?? null,
        durationMin: normalizeOptionalMeasure(workout.durationMin) ?? null,
        targetPace: blankToUndefined(workout.targetPace)?.slice(0, 80) ?? null,
      });
    }
    weeks.push({
      weekNumber: week.weekNumber,
      focus: blankToUndefined(week.focus)?.slice(0, 500) ?? null,
      notes: blankToUndefined(week.notes)?.slice(0, 2000) ?? null,
      workouts,
    });
  }

  const raceDate = canonicalIsoDate(input.raceDate) ?? null;
  return {
    ok: true,
    reason: coercePlanWriteReason(input.reason, "new_plan"),
    replaceActive: input.replaceActive !== false,
    draft: {
      title: title.slice(0, 200),
      goal: blankToUndefined(input.goal)?.slice(0, 1000) ?? null,
      startDate,
      endDate: canonicalIsoDate(input.endDate) ?? null,
      notes: blankToUndefined(input.notes)?.slice(0, 4000) ?? null,
      raceDate,
      taperDays: clampRaceTaperDays(
        input.taperDays,
        Boolean(raceDate) || hasRaceWorkout,
      ),
      weeks,
    },
  };
}

function normalizeScheduleDay(
  value: number | null | undefined,
  label: string,
): { ok: true; day: number } | { ok: false; error: string } {
  const day = normalizePlanDayOfWeek(value, null);
  if (day == null) {
    return {
      ok: false,
      error: `${label} needs a dayOfWeek from 0 (Monday) through 6 (Sunday).`,
    };
  }
  return { ok: true, day };
}

export function normalizeScheduleEditInput(input: {
  reason?: string | null;
  operations?: Array<
    | {
        op: "move";
        from: {
          weekNumber: number;
          dayOfWeek?: number | null;
          title?: string | null;
        };
        toWeekNumber: number;
        toDayOfWeek?: number | null;
      }
    | {
        op: "swap";
        a: { weekNumber: number; dayOfWeek?: number | null };
        b: { weekNumber: number; dayOfWeek?: number | null };
      }
    | {
        op: "shift";
        weekNumber: number;
        dayOfWeek?: number | null;
        title?: string | null;
        days: number;
      }
  > | null;
}):
  | { ok: true; reason: PlanWriteReason; operations: ScheduleOperation[] }
  | { ok: false; error: string } {
  if (!input.operations || input.operations.length === 0) {
    return { ok: false, error: "At least one schedule operation is required." };
  }
  const operations: ScheduleOperation[] = [];
  for (const operation of input.operations) {
    if (operation.op === "move") {
      const fromDay = normalizeScheduleDay(operation.from.dayOfWeek, "move.from");
      if (!fromDay.ok) return fromDay;
      const toDay = normalizeScheduleDay(operation.toDayOfWeek, "move.toDayOfWeek");
      if (!toDay.ok) return toDay;
      operations.push({
        op: "move",
        from: {
          weekNumber: operation.from.weekNumber,
          dayOfWeek: fromDay.day,
          title: blankToUndefined(operation.from.title ?? undefined),
        },
        toWeekNumber: operation.toWeekNumber,
        toDayOfWeek: toDay.day,
      });
      continue;
    }
    if (operation.op === "swap") {
      const a = normalizeScheduleDay(operation.a.dayOfWeek, "swap.a");
      if (!a.ok) return a;
      const b = normalizeScheduleDay(operation.b.dayOfWeek, "swap.b");
      if (!b.ok) return b;
      operations.push({
        op: "swap",
        a: { weekNumber: operation.a.weekNumber, dayOfWeek: a.day },
        b: { weekNumber: operation.b.weekNumber, dayOfWeek: b.day },
      });
      continue;
    }
    if (operation.days === 0) {
      return { ok: false, error: "days cannot be 0" };
    }
    const day = normalizeScheduleDay(operation.dayOfWeek, "shift");
    if (!day.ok) return day;
    operations.push({
      op: "shift",
      weekNumber: operation.weekNumber,
      dayOfWeek: day.day,
      title: blankToUndefined(operation.title ?? undefined),
      days: operation.days,
    });
  }
  return {
    ok: true,
    reason: coercePlanWriteReason(input.reason, "schedule_edit"),
    operations,
  };
}

async function persistTrainingPlan(
  userId: string,
  prepared: NormalizedPlan,
  replaceActive: boolean,
): Promise<SavedPlanRecord> {
  return prisma.$transaction(async (tx) => {
    if (replaceActive) {
      await tx.trainingPlan.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });

      // Retention: keep last N inactive plans, delete older ones
      const inactive = await tx.trainingPlan.findMany({
        where: { userId, isActive: false },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (inactive.length > MAX_INACTIVE_PLANS) {
        const toDelete = inactive.slice(MAX_INACTIVE_PLANS).map((p) => p.id);
        await tx.trainingPlan.deleteMany({
          where: { id: { in: toDelete }, userId },
        });
      }
    }

    const plan = await tx.trainingPlan.create({
      data: {
        userId,
        title: prepared.title,
        goal: prepared.goal ?? null,
        startDate: parseIsoDateAtNoon(prepared.startDate),
        endDate: prepared.endDate ? parseIsoDateAtNoon(prepared.endDate) : null,
        raceDate: prepared.raceDate
          ? parseIsoDateAtNoon(prepared.raceDate)
          : null,
        taperDays: prepared.taperDays,
        notes: prepared.notes ?? null,
        isActive: true,
        weeks: {
          create: prepared.weeks.map((w) => ({
            weekNumber: w.weekNumber,
            focus: w.focus ?? null,
            notes: w.notes ?? null,
            workouts: {
              create: w.workouts.map((wo) => ({
                dayOfWeek: wo.dayOfWeek,
                date: parseIsoDateAtNoon(
                  workoutIsoDate(prepared.startDate, w.weekNumber, wo),
                ),
                type: wo.type,
                title: wo.title,
                description: wo.description ?? null,
                distanceMiles: wo.distanceMiles ?? null,
                durationMin: wo.durationMin ?? null,
                targetPace: wo.targetPace?.trim() || null,
              })),
            },
          })),
        },
      },
      include: {
        weeks: { include: { workouts: true } },
      },
    });
    return {
      id: plan.id,
      title: plan.title,
      weeks: plan.weeks.map((week) => ({ workouts: week.workouts })),
    };
  }, { maxWait: 10_000, timeout: 25_000 });
}

export function createCoachTools(
  userId: string,
  options?: {
    timeZone?: string | null;
    /** interactive = athlete is in chat. automatic = post-run debrief with no fresh yes. */
    mode?: PlanWriteMode;
    /** Latest athlete message, used to tell a real schedule request from missed work. */
    userText?: string | null;
    /** Test seam. Production writes through Prisma. */
    persistPlan?: (
      plan: NormalizedPlan,
      replaceActive: boolean,
    ) => Promise<SavedPlanRecord>;
  },
) {
  const mode = options?.mode ?? "interactive";
  const userText = options?.userText ?? null;
  const planRepository = createPrismaPlanRepository();
  const clock = getCoachClock(options?.timeZone);

  return {
    get_current_datetime: tool({
      description:
        "Return the athlete's authoritative current date and time. Call this if you are unsure what day it is before talking about today/tomorrow or logging a run.",
      inputSchema: z.object({}),
      execute: async () => {
        const fresh = getCoachClock(options?.timeZone);
        return {
          isoDate: fresh.isoDate,
          weekday: fresh.weekday,
          planDayOfWeek: fresh.planDayOfWeek,
          longDate: fresh.longDate,
          localTime: fresh.localTime,
          timeZone: fresh.timeZone,
          yesterdayIso: fresh.yesterdayIso,
          tomorrowIso: fresh.tomorrowIso,
        };
      },
    }),

    get_recent_runs: tool({
      description:
        "Fetch the athlete's recent logged runs to inform coaching advice.",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many runs to return (default 10)"),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("Only runs within the last N days"),
      }),
      execute: async ({ limit = 10, days }) => {
        const where: { userId: string; date?: { gte: Date } } = { userId };
        if (days) {
          const since = new Date();
          since.setDate(since.getDate() - days);
          where.date = { gte: since };
        }
        const runs = await prisma.run.findMany({
          where,
          orderBy: { date: "desc" },
          take: limit,
        });
        return {
          count: runs.length,
          runs: runs.map((r) => ({
            id: r.id,
            date: r.date.toISOString().slice(0, 10),
            distanceMiles: r.distanceMiles,
            durationMin: r.durationMin,
            type: r.type,
            notes: r.notes,
            perceivedEffort: r.perceivedEffort,
            source: r.source,
          })),
        };
      },
    }),

    get_current_plan: tool({
      description:
        "Get the athlete's active training plan with weeks and workouts.",
      inputSchema: z.object({}),
      execute: async () => {
        const plan = await prisma.trainingPlan.findFirst({
          where: { userId, isActive: true },
          include: {
            weeks: {
              orderBy: { weekNumber: "asc" },
              include: {
                workouts: { orderBy: { dayOfWeek: "asc" } },
              },
            },
          },
        });
        if (!plan) return { plan: null, message: "No active training plan." };
        return {
          plan: {
            id: plan.id,
            title: plan.title,
            goal: plan.goal,
            startDate: plan.startDate.toISOString().slice(0, 10),
            endDate: plan.endDate?.toISOString().slice(0, 10) ?? null,
            notes: plan.notes,
            raceDate: plan.raceDate?.toISOString().slice(0, 10) ?? null,
            taperDays: plan.taperDays,
            weeks: plan.weeks.map((w) => ({
              weekNumber: w.weekNumber,
              focus: w.focus,
              notes: w.notes,
              workouts: w.workouts.map((wo) => ({
                id: wo.id,
                dayOfWeek: wo.dayOfWeek,
                date: wo.date?.toISOString().slice(0, 10) ?? null,
                type: wo.type,
                title: wo.title,
                description: wo.description,
                distanceMiles: wo.distanceMiles,
                durationMin: wo.durationMin,
                targetPace: wo.targetPace,
                completed: wo.completed,
                completionStatus: wo.completionStatus,
              })),
            })),
          },
        };
      },
    }),

    save_run: tool({
      description:
        "Log a completed run for the athlete when they describe one in chat. Distance must be in miles.",
      inputSchema: z.object({
        date: z.string().describe(
          `ISO date YYYY-MM-DD. A time suffix is stripped. If the athlete means today or omits the date, use ${clock.isoDate} (${clock.weekday}). Do not invent other dates.`,
        ),
        distanceMiles: z
          .number()
          .finite()
          .positive()
          .max(300)
          .describe("Distance in miles"),
        durationMin: looseMeasure,
        type: runTypeSchema,
        notes: looseText(4000),
        perceivedEffort: z.number().int().nullish(),
      }),
      execute: async (input) => {
        const date = canonicalIsoDate(input.date);
        if (!date) {
          return {
            success: false as const,
            message: "Date must be a real calendar day as YYYY-MM-DD.",
          };
        }
        const perceived =
          input.perceivedEffort != null &&
          input.perceivedEffort >= 1 &&
          input.perceivedEffort <= 10
            ? input.perceivedEffort
            : null;
        const run = await prisma.run.create({
          data: {
            userId,
            date: parseIsoDateAtNoon(date),
            distanceMiles: input.distanceMiles,
            durationMin: normalizeOptionalMeasure(input.durationMin) ?? null,
            type: input.type,
            notes: blankToUndefined(input.notes) ?? null,
            perceivedEffort: perceived,
            source: "coach",
          },
        });
        return {
          success: true,
          runId: run.id,
          message: `Logged ${run.distanceMiles} mi ${run.type} run on ${date}.`,
        };
      },
    }),

    save_or_update_plan: tool({
      description:
        "Create or replace the athlete's full training plan in one call. weeks is required: include every week and its workouts in this same call, with each workout description kept to 1-2 sentences (warm-up, main set, cool-down). A missing or empty weeks array is not saved. dayOfWeek is 0=Monday through 6=Sunday (Friday is 4); 7 is accepted as Sunday. Workout type may be a common alias (recovery, threshold, vo2, long_run, lift, bjj, off) and is normalized. Optional fields may be null. reason may be omitted. Race plans should set raceDate and a type race workout on that date (set date to raceDate). taperDays is clamped to 10–14 (default 12) when a race is set. The server rejects stacked hard days, a reckless mileage jump once volume is near the top of the block, a long-run jump, quality inside the taper, and a missing race-day workout. Easy-mile share, cutback weeks, phase-to-phase volume, and taper volume are coaching notes and do not block the save. If the tool returns errors, fix them and call again with the full weeks array before telling the athlete the plan is saved. For a move/shift/swap of existing workouts, use edit_plan_schedule instead. Do not call this to add make-up miles for missed work unless the athlete clearly agreed.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        goal: looseText(1000),
        startDate: z
          .string()
          .nullish()
          .describe(
            "ISO date YYYY-MM-DD for week 1. A time suffix is stripped. Any day is fine; the plan UI snaps to that week's Monday. Prefer the Monday of the training week when possible.",
          ),
        endDate: z.string().nullish(),
        raceDate: z
          .string()
          .nullish()
          .describe(
            "Goal race day YYYY-MM-DD. A time suffix is stripped. The taper is the 10–14 days before this date. Also set that day's workout date to this value.",
          ),
        taperDays: z
          .number()
          .int()
          .nullish()
          .describe(
            "Days of taper before race day, not counting race day. Optional. Omitted or out-of-range values are clamped to 10–14 (default 12) when the plan has a race.",
          ),
        reason: z
          .string()
          .nullish()
          .describe(
            "Optional. new_plan or athlete_requested when they asked for a plan. schedule_edit only if a full rewrite is truly required — prefer edit_plan_schedule. agreed_makeup only after an explicit yes. recovery_adjustment to lower load for fatigue or injury. Omitted or unknown values are saved as new_plan. Never use a make-up reason for missed work they have not agreed to.",
          ),
        notes: looseText(4000),
        replaceActive: z
          .boolean()
          .nullish()
          .describe("If true (default), deactivate previous active plans"),
        weeks: z
          .array(weekInputSchema)
          .max(MAX_PLAN_WEEKS)
          .nullish()
          .describe(
            "REQUIRED. Every week and its workouts, in this same call. Keep workout descriptions to 1-2 sentences. Missing or empty is rejected without saving.",
          ),
      }),
      execute: async (input) => {
        const normalized = normalizeSavePlanToolInput(input);
        if (!normalized.ok) {
          return {
            success: false as const,
            error: normalized.error,
            message: normalized.error,
          };
        }
        const previousRunningMiles =
          mode === "automatic" ? await activePlanRunningMiles(userId) : null;
        const decision = handlePlanSave({
          mode,
          userText,
          reason: normalized.reason,
          previousRunningMiles,
          draft: normalized.draft,
        });
        if (!decision.success) {
          return {
            success: false,
            message: decision.message,
            issues: decision.issues ?? [],
          };
        }

        const prepared = decision.plan;
        const plan = await (options?.persistPlan ??
          ((next, replaceActive) =>
            persistTrainingPlan(userId, next, replaceActive)))(
          prepared,
          normalized.replaceActive,
        );

        const workoutCount = plan.weeks.reduce(
          (n, w) => n + w.workouts.length,
          0,
        );

        return {
          success: true,
          planId: plan.id,
          weeks: plan.weeks.length,
          workouts: workoutCount,
          raceDate: prepared.raceDate,
          taperDays: prepared.taperDays,
          warnings: decision.warnings,
          message: `Saved plan "${plan.title}" with ${plan.weeks.length} weeks / ${workoutCount} workouts. ${decision.message}`,
        };
      },
    }),

    edit_plan_schedule: tool({
      description:
        "Move, swap, or shift workouts on the athlete's stored active plan. Call this whenever they ask to move, shift, swap, switch, or reschedule a workout or a day — then confirm only after it returns success. This writes the Plan tab. Do not only talk about the change. Do not use this to force make-up miles after a missed workout unless they asked to move that workout or clearly agreed. reason is optional and defaults to schedule_edit.",
      inputSchema: z.object({
        reason: z.string().nullish(),
        operations: z
          .array(
            z.discriminatedUnion("op", [
              z.object({
                op: z.literal("move"),
                from: dayRefSchema.extend({
                  title: looseText(200).describe(
                    "Exact workout title. Omit or null to move every workout on that day.",
                  ),
                }),
                toWeekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
                toDayOfWeek: looseDayOfWeek,
              }),
              z.object({
                op: z.literal("swap"),
                a: dayRefSchema,
                b: dayRefSchema,
              }),
              z.object({
                op: z.literal("shift"),
                weekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
                dayOfWeek: looseDayOfWeek,
                title: looseText(200).describe(
                  "Exact workout title. Omit or null to shift every workout on that day.",
                ),
                days: z.number().int().min(-60).max(60),
              }),
            ]),
          )
          .min(1)
          .max(12),
      }),
      execute: async (input) => {
        const normalized = normalizeScheduleEditInput(input);
        if (!normalized.ok) {
          return { success: false, message: normalized.error };
        }
        try {
          return await handlePlanScheduleEdit({
            repo: planRepository,
            userId,
            mode,
            userText,
            reason: normalized.reason,
            operations: normalized.operations,
          });
        } catch (err) {
          console.error("edit_plan_schedule failed:", err);
          return {
            success: false,
            message:
              "Couldn't update the plan. Please try that change again.",
          };
        }
      },
    }),

    update_coach_profile: tool({
      description:
        "Update the athlete's long-term coach profile (goals, injuries, preferences, etc.). Merge new facts; do not wipe unknown fields unless intentionally clearing. includeStrength is normally set in Settings — only change if they clearly ask.",
      inputSchema: z.object({
        summary: z.string().max(PROFILE_MAX).optional(),
        goals: z.string().max(PROFILE_MAX).optional(),
        injuries: z.string().max(PROFILE_MAX).optional(),
        preferences: z.string().max(PROFILE_MAX).optional(),
        raceCalendar: z.string().max(PROFILE_MAX).optional(),
        fitnessLevel: z.string().max(PROFILE_MAX).optional(),
        schedule: z.string().max(PROFILE_MAX).optional(),
        includeStrength: z
          .boolean()
          .optional()
          .describe(
            "If true, program separate running-focused strength sessions in plans",
          ),
      }),
      execute: async (input) => {
        const data: Record<string, string | boolean> = {};
        for (const key of [
          "summary",
          "goals",
          "injuries",
          "preferences",
          "raceCalendar",
          "fitnessLevel",
          "schedule",
        ] as const) {
          if (input[key] !== undefined) data[key] = input[key]!;
        }
        if (input.includeStrength !== undefined) {
          data.includeStrength = input.includeStrength;
        }

        const profile = await prisma.coachProfile.upsert({
          where: { userId },
          create: {
            userId,
            summary: (data.summary as string) ?? "",
            goals: (data.goals as string) ?? "",
            injuries: (data.injuries as string) ?? "",
            preferences: (data.preferences as string) ?? "",
            raceCalendar: (data.raceCalendar as string) ?? "",
            fitnessLevel: (data.fitnessLevel as string) ?? "",
            schedule: (data.schedule as string) ?? "",
            includeStrength: Boolean(data.includeStrength),
          },
          update: data,
        });

        return {
          success: true,
          message: "Coach profile updated.",
          profile: {
            summary: profile.summary,
            goals: profile.goals,
            injuries: profile.injuries,
            preferences: profile.preferences,
            raceCalendar: profile.raceCalendar,
            fitnessLevel: profile.fitnessLevel,
            schedule: profile.schedule,
            includeStrength: profile.includeStrength,
          },
        };
      },
    }),

    create_calendar_events: tool({
      description:
        "Push upcoming plan workouts to the athlete's Google Calendar if connected. Call only after a plan exists. Skips workouts that already have a calendar event.",
      inputSchema: z.object({
        planId: z
          .string()
          .optional()
          .describe("Plan id; defaults to active plan"),
        maxWorkouts: z.number().int().min(1).max(60).optional(),
      }),
      execute: async ({ planId, maxWorkouts = 21 }) => {
        if (!isGoogleConfigured()) {
          return {
            success: false,
            message:
              "Google Calendar is not configured on this server. Plans still work in-app; connect OAuth env vars later.",
          };
        }

        const connection = await prisma.googleCalendar.findUnique({
          where: { userId },
        });
        if (!connection) {
          return {
            success: false,
            message:
              "Google Calendar is not connected. Ask the athlete to connect it in Settings.",
          };
        }

        const plan = planId
          ? await prisma.trainingPlan.findFirst({
              where: { id: planId, userId },
              include: {
                weeks: {
                  include: { workouts: true },
                  orderBy: { weekNumber: "asc" },
                },
              },
            })
          : await prisma.trainingPlan.findFirst({
              where: { userId, isActive: true },
              include: {
                weeks: {
                  include: { workouts: true },
                  orderBy: { weekNumber: "asc" },
                },
              },
            });

        if (!plan) {
          return { success: false, message: "No plan found to sync." };
        }

        const workouts = plan.weeks
          .flatMap((w) =>
            w.workouts.map((wo) => ({
              ...wo,
              weekNumber: w.weekNumber,
              planStart: plan.startDate,
            })),
          )
          .filter((wo) => wo.type !== "rest" && !wo.googleEventId)
          .slice(0, maxWorkouts);

        try {
          const result = await createEventsFromWorkouts(userId, workouts);
          return {
            success: true,
            created: result.created,
            skipped: result.skipped,
            message: `Created ${result.created} calendar event(s)${result.skipped ? `, skipped ${result.skipped}` : ""}.`,
          };
        } catch (err) {
          console.error("create_calendar_events tool error:", err);
          // Never forward raw Google/API bodies into tool results (chat persistence)
          const safe =
            err instanceof Error &&
            (err.message.includes("reconnect") ||
              err.message.includes("not connected") ||
              err.message.includes("Settings"))
              ? err.message
              : "Calendar sync failed. Ask the athlete to reconnect Google Calendar in Settings if the problem continues.";
          return {
            success: false,
            message: safe,
          };
        }
      },
    }),
  };
}

export type CoachTools = ReturnType<typeof createCoachTools>;
