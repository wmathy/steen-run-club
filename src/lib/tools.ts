import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCoachClock } from "@/lib/clock";
import {
  createEventsFromWorkouts,
  isGoogleConfigured,
} from "@/lib/google-calendar";
import { handlePlanSave, handlePlanScheduleEdit } from "@/lib/plan-actions";
import { dateForPlanSlot } from "@/lib/plan-dates";
import {
  activePlanRunningMiles,
  createPrismaPlanRepository,
} from "@/lib/plan-repository";
import type { PlanWriteMode, PlanWriteReason } from "@/lib/plan-policy";
import {
  isoDateSchema,
  MAX_PLAN_WEEKS,
  MAX_WORKOUTS_PER_WEEK,
  parseIsoDateAtNoon,
  runTypeSchema,
  workoutTypeSchema,
} from "@/lib/validation";

const PROFILE_MAX = 4000;
const MAX_INACTIVE_PLANS = 10;

const PLAN_WRITE_REASONS = [
  "new_plan",
  "athlete_requested",
  "schedule_edit",
  "agreed_makeup",
  "recovery_adjustment",
] as const satisfies readonly PlanWriteReason[];

const dayRefSchema = z.object({
  weekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
  dayOfWeek: z
    .number()
    .int()
    .min(0)
    .max(6)
    .describe("0=Monday … 6=Sunday"),
});

export function createCoachTools(
  userId: string,
  options?: {
    timeZone?: string | null;
    /** interactive = athlete is in chat. automatic = post-run debrief with no fresh yes. */
    mode?: PlanWriteMode;
    /** Latest athlete message, used to tell a real schedule request from missed work. */
    userText?: string | null;
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
        date: isoDateSchema.describe(
          `ISO date YYYY-MM-DD. If the athlete means today or omits the date, use ${clock.isoDate} (${clock.weekday}). Do not invent other dates.`,
        ),
        distanceMiles: z
          .number()
          .finite()
          .positive()
          .max(300)
          .describe("Distance in miles"),
        durationMin: z.number().finite().positive().max(24 * 60).optional(),
        type: runTypeSchema,
        notes: z.string().max(4000).optional(),
        perceivedEffort: z.number().int().min(1).max(10).optional(),
      }),
      execute: async (input) => {
        const run = await prisma.run.create({
          data: {
            userId,
            date: parseIsoDateAtNoon(input.date),
            distanceMiles: input.distanceMiles,
            durationMin: input.durationMin ?? null,
            type: input.type,
            notes: input.notes ?? null,
            perceivedEffort: input.perceivedEffort ?? null,
            source: "coach",
          },
        });
        return {
          success: true,
          runId: run.id,
          message: `Logged ${run.distanceMiles} mi ${run.type} run on ${input.date}.`,
        };
      },
    }),

    save_or_update_plan: tool({
      description:
        "Create or replace the athlete's active structured training plan (weeks + daily workouts). Race plans must set raceDate and taperDays (10–14). The server rejects plans that skip the base → build → peak progression, stack hard days, ramp mileage too fast, or use a taper outside 10–14 days. If the tool returns errors, fix them and call it again before telling the athlete the plan is saved. For a move/shift/swap of existing workouts, use edit_plan_schedule instead. Do not call this to add make-up miles for missed work unless the athlete clearly agreed.",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        goal: z.string().max(1000).optional(),
        startDate: isoDateSchema.describe(
          "ISO date YYYY-MM-DD for week 1 (any day is fine; the plan UI snaps to that week's Monday). Prefer the Monday of the training week when possible.",
        ),
        endDate: isoDateSchema.optional(),
        raceDate: isoDateSchema
          .optional()
          .describe(
            "Goal race day YYYY-MM-DD. Required for a race plan. The taper is the 10–14 days before this date.",
          ),
        taperDays: z
          .number()
          .int()
          .min(10)
          .max(14)
          .optional()
          .describe(
            "Days of taper before race day, not counting race day. Required with raceDate. Minimum 10, maximum 14.",
          ),
        reason: z
          .enum(PLAN_WRITE_REASONS)
          .describe(
            "new_plan or athlete_requested when they asked for a plan. schedule_edit only if a full rewrite is truly required — prefer edit_plan_schedule. agreed_makeup only after an explicit yes. recovery_adjustment to lower load for fatigue or injury. Never use a make-up reason for missed work they have not agreed to.",
          ),
        notes: z.string().max(4000).optional(),
        replaceActive: z
          .boolean()
          .optional()
          .describe("If true (default), deactivate previous active plans"),
        weeks: z
          .array(
            z.object({
              weekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
              focus: z.string().max(500).optional(),
              notes: z.string().max(2000).optional(),
              workouts: z
                .array(
                  z.object({
                    dayOfWeek: z
                      .number()
                      .int()
                      .min(0)
                      .max(6)
                      .describe("0=Monday … 6=Sunday"),
                    date: isoDateSchema.optional(),
                    type: workoutTypeSchema,
                    title: z.string().min(1).max(200),
                    description: z
                      .string()
                      .max(4000)
                      .optional()
                      .describe(
                        "Full workout detail. Runs: structure, cues, warm-up/cool-down, effort feel. Strength: list each exercise with sets×reps (e.g. Romanian deadlift 3×8), warm-up/cool-down; session 30–45 min.",
                      ),
                    distanceMiles: z
                      .number()
                      .finite()
                      .positive()
                      .max(300)
                      .optional()
                      .describe(
                        "Distance in miles (running only; omit for strength/rest)",
                      ),
                    durationMin: z
                      .number()
                      .finite()
                      .positive()
                      .max(24 * 60)
                      .optional()
                      .describe(
                        "Duration in minutes. Strength sessions should be 30–45.",
                      ),
                    targetPace: z
                      .string()
                      .max(80)
                      .optional()
                      .describe(
                        'Suggested pace as min/mi for runs, e.g. "9:30/mi". Omit for strength/rest.',
                      ),
                  }),
                )
                .max(MAX_WORKOUTS_PER_WEEK),
            }),
          )
          .min(1)
          .max(MAX_PLAN_WEEKS),
      }),
      execute: async (input) => {
        const previousRunningMiles =
          mode === "automatic" ? await activePlanRunningMiles(userId) : null;
        const decision = handlePlanSave({
          mode,
          userText,
          reason: input.reason,
          previousRunningMiles,
          draft: {
            title: input.title,
            goal: input.goal,
            startDate: input.startDate,
            endDate: input.endDate,
            notes: input.notes,
            raceDate: input.raceDate,
            taperDays: input.taperDays,
            weeks: input.weeks,
          },
        });
        if (!decision.success) {
          return {
            success: false,
            message: decision.message,
            issues: decision.issues ?? [],
          };
        }

        const prepared = decision.plan;
        const replaceActive = input.replaceActive !== false;

        const plan = await prisma.$transaction(async (tx) => {
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
              const toDelete = inactive
                .slice(MAX_INACTIVE_PLANS)
                .map((p) => p.id);
              await tx.trainingPlan.deleteMany({
                where: { id: { in: toDelete }, userId },
              });
            }
          }

          return tx.trainingPlan.create({
            data: {
              userId,
              title: prepared.title,
              goal: prepared.goal ?? null,
              startDate: parseIsoDateAtNoon(prepared.startDate),
              endDate: prepared.endDate
                ? parseIsoDateAtNoon(prepared.endDate)
                : null,
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
                        dateForPlanSlot(
                          prepared.startDate,
                          w.weekNumber,
                          wo.dayOfWeek,
                        ),
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
        });

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
          message: `Saved plan "${plan.title}" with ${plan.weeks.length} weeks / ${workoutCount} workouts. ${decision.message}`,
        };
      },
    }),

    edit_plan_schedule: tool({
      description:
        "Move, swap, or shift workouts on the athlete's stored active plan. Call this whenever they ask to move, shift, swap, switch, or reschedule a workout or a day — then confirm only after it returns success. This writes the Plan tab. Do not only talk about the change. Do not use this to force make-up miles after a missed workout unless they asked to move that workout or clearly agreed.",
      inputSchema: z.object({
        operations: z
          .array(
            z.discriminatedUnion("op", [
              z.object({
                op: z.literal("move"),
                from: dayRefSchema.extend({
                  title: z
                    .string()
                    .min(1)
                    .max(200)
                    .optional()
                    .describe(
                      "Exact workout title. Omit to move every workout on that day.",
                    ),
                }),
                toWeekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
                toDayOfWeek: z.number().int().min(0).max(6),
              }),
              z.object({
                op: z.literal("swap"),
                a: dayRefSchema,
                b: dayRefSchema,
              }),
              z.object({
                op: z.literal("shift"),
                weekNumber: z.number().int().min(1).max(MAX_PLAN_WEEKS),
                dayOfWeek: z.number().int().min(0).max(6),
                title: z
                  .string()
                  .min(1)
                  .max(200)
                  .optional()
                  .describe(
                    "Exact workout title. Omit to shift every workout on that day.",
                  ),
                days: z
                  .number()
                  .int()
                  .min(-60)
                  .max(60)
                  .refine((days) => days !== 0, "days cannot be 0"),
              }),
            ]),
          )
          .min(1)
          .max(12),
      }),
      execute: async ({ operations }) => {
        try {
          return await handlePlanScheduleEdit({
            repo: planRepository,
            userId,
            mode,
            userText,
            operations,
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
