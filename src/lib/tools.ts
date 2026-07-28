import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createEventsFromWorkouts,
  isGoogleConfigured,
} from "@/lib/google-calendar";
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

export function createCoachTools(userId: string) {
  return {
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
            weeks: plan.weeks.map((w) => ({
              weekNumber: w.weekNumber,
              focus: w.focus,
              notes: w.notes,
              workouts: w.workouts.map((wo) => ({
                dayOfWeek: wo.dayOfWeek,
                date: wo.date?.toISOString().slice(0, 10) ?? null,
                type: wo.type,
                title: wo.title,
                description: wo.description,
                distanceMiles: wo.distanceMiles,
                durationMin: wo.durationMin,
                completed: wo.completed,
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
          "ISO date YYYY-MM-DD (use today if not specified)",
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
        "Create or replace the athlete's active structured training plan (weeks + daily workouts).",
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        goal: z.string().max(1000).optional(),
        startDate: isoDateSchema.describe(
          "ISO date YYYY-MM-DD for week 1 (any day is fine; the plan UI snaps to that week's Monday). Prefer the Monday of the training week when possible.",
        ),
        endDate: isoDateSchema.optional(),
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
                    description: z.string().max(2000).optional(),
                    distanceMiles: z
                      .number()
                      .finite()
                      .positive()
                      .max(300)
                      .optional()
                      .describe("Distance in miles"),
                    durationMin: z
                      .number()
                      .finite()
                      .positive()
                      .max(24 * 60)
                      .optional(),
                  }),
                )
                .max(MAX_WORKOUTS_PER_WEEK),
            }),
          )
          .min(1)
          .max(MAX_PLAN_WEEKS),
      }),
      execute: async (input) => {
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
              title: input.title,
              goal: input.goal ?? null,
              startDate: parseIsoDateAtNoon(input.startDate),
              endDate: input.endDate
                ? parseIsoDateAtNoon(input.endDate)
                : null,
              notes: input.notes ?? null,
              isActive: true,
              weeks: {
                create: input.weeks.map((w) => ({
                  weekNumber: w.weekNumber,
                  focus: w.focus ?? null,
                  notes: w.notes ?? null,
                  workouts: {
                    create: w.workouts.map((wo) => ({
                      dayOfWeek: wo.dayOfWeek,
                      date: wo.date ? parseIsoDateAtNoon(wo.date) : null,
                      type: wo.type,
                      title: wo.title,
                      description: wo.description ?? null,
                      distanceMiles: wo.distanceMiles ?? null,
                      durationMin: wo.durationMin ?? null,
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
          message: `Saved plan "${plan.title}" with ${plan.weeks.length} weeks / ${workoutCount} workouts.`,
        };
      },
    }),

    update_coach_profile: tool({
      description:
        "Update the athlete's long-term coach profile (goals, injuries, preferences, etc.). Merge new facts; do not wipe unknown fields unless intentionally clearing.",
      inputSchema: z.object({
        summary: z.string().max(PROFILE_MAX).optional(),
        goals: z.string().max(PROFILE_MAX).optional(),
        injuries: z.string().max(PROFILE_MAX).optional(),
        preferences: z.string().max(PROFILE_MAX).optional(),
        raceCalendar: z.string().max(PROFILE_MAX).optional(),
        fitnessLevel: z.string().max(PROFILE_MAX).optional(),
        schedule: z.string().max(PROFILE_MAX).optional(),
      }),
      execute: async (input) => {
        const data: Record<string, string> = {};
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

        const profile = await prisma.coachProfile.upsert({
          where: { userId },
          create: {
            userId,
            summary: data.summary ?? "",
            goals: data.goals ?? "",
            injuries: data.injuries ?? "",
            preferences: data.preferences ?? "",
            raceCalendar: data.raceCalendar ?? "",
            fitnessLevel: data.fitnessLevel ?? "",
            schedule: data.schedule ?? "",
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
