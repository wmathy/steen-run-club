import { prisma } from "@/lib/prisma";
import { parseIsoDateAtNoon } from "@/lib/validation";
import type { PlanRepository } from "@/lib/plan-actions";
import type { StoredPlan, StoredWeek, StoredWorkout } from "@/lib/plan-model";
import { totalRunningMiles } from "@/lib/plan-rules";

function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

type PlanRow = {
  id: string;
  title: string;
  goal: string | null;
  startDate: Date;
  endDate: Date | null;
  notes: string | null;
  raceDate: Date | null;
  taperDays: number | null;
  weeks: Array<{
    weekNumber: number;
    focus: string | null;
    notes: string | null;
    workouts: Array<{
      id: string;
      dayOfWeek: number;
      date: Date | null;
      type: string;
      title: string;
      description: string | null;
      distanceMiles: number | null;
      durationMin: number | null;
      targetPace: string | null;
      effortLevel: string | null;
      completed: boolean;
      completionStatus: string | null;
    }>;
  }>;
};

function toSnapshot(plan: PlanRow): StoredPlan {
  const weeks: StoredWeek[] = plan.weeks.map((week) => ({
    weekNumber: week.weekNumber,
    focus: week.focus,
    notes: week.notes,
    workouts: week.workouts.map(
      (workout): StoredWorkout => ({
        id: workout.id,
        dayOfWeek: workout.dayOfWeek,
        date: isoDate(workout.date),
        type: workout.type,
        title: workout.title,
        description: workout.description,
        distanceMiles: workout.distanceMiles,
        durationMin: workout.durationMin,
        targetPace: workout.targetPace,
        effortLevel: workout.effortLevel,
        completed: workout.completed,
        completionStatus: workout.completionStatus,
      }),
    ),
  }));

  return {
    id: plan.id,
    title: plan.title,
    goal: plan.goal,
    startDate: isoDate(plan.startDate) ?? plan.startDate.toISOString().slice(0, 10),
    endDate: isoDate(plan.endDate),
    notes: plan.notes,
    raceDate: isoDate(plan.raceDate),
    taperDays: plan.taperDays,
    weeks,
  };
}

const planInclude = {
  weeks: {
    orderBy: { weekNumber: "asc" as const },
    include: {
      workouts: { orderBy: { dayOfWeek: "asc" as const } },
    },
  },
};

export async function loadActivePlan(userId: string): Promise<StoredPlan | null> {
  const plan = await prisma.trainingPlan.findFirst({
    where: { userId, isActive: true },
    include: planInclude,
  });
  return plan ? toSnapshot(plan) : null;
}

export function createPrismaPlanRepository(): PlanRepository {
  return {
    loadActive: loadActivePlan,
    async saveSchedule(userId, next) {
      await prisma.$transaction(async (tx) => {
        const owned = await tx.trainingPlan.findFirst({
          where: { id: next.id, userId },
          select: { id: true },
        });
        if (!owned) {
          throw new Error("Plan not found");
        }

        const existingWeeks = await tx.planWeek.findMany({
          where: { planId: next.id },
        });
        const byNumber = new Map(existingWeeks.map((week) => [week.weekNumber, week]));

        for (const week of next.weeks) {
          if (byNumber.has(week.weekNumber)) continue;
          const created = await tx.planWeek.create({
            data: {
              planId: next.id,
              weekNumber: week.weekNumber,
              focus: week.focus,
              notes: week.notes,
            },
          });
          byNumber.set(week.weekNumber, created);
        }

        const existingWorkouts = await tx.planWorkout.findMany({
          where: { week: { planId: next.id } },
          select: { id: true },
        });
        const existingIds = new Set(existingWorkouts.map((workout) => workout.id));
        const keepIds: string[] = [];

        for (const week of next.weeks) {
          const row = byNumber.get(week.weekNumber);
          if (!row) continue;
          for (const workout of week.workouts) {
            keepIds.push(workout.id);
            const data = {
              weekId: row.id,
              dayOfWeek: workout.dayOfWeek,
              date: workout.date ? parseIsoDateAtNoon(workout.date) : null,
              type: workout.type,
              title: workout.title,
              description: workout.description,
              distanceMiles: workout.distanceMiles,
              durationMin: workout.durationMin,
              targetPace: workout.targetPace,
              effortLevel: workout.effortLevel,
            };
            if (existingIds.has(workout.id)) {
              await tx.planWorkout.update({
                where: { id: workout.id },
                data,
              });
            } else {
              await tx.planWorkout.create({
                data: {
                  id: workout.id,
                  ...data,
                  completed: workout.completed,
                  completionStatus: workout.completionStatus,
                },
              });
            }
          }
        }

        await tx.planWorkout.deleteMany({
          where:
            keepIds.length === 0
              ? { week: { planId: next.id } }
              : { week: { planId: next.id }, id: { notIn: keepIds } },
        });

        const remaining = await tx.planWorkout.findMany({
          where: { week: { planId: next.id } },
          select: { weekId: true },
        });
        const used = new Set(remaining.map((workout) => workout.weekId));
        const staleIds = existingWeeks
          .filter((week) => !used.has(week.id))
          .map((week) => week.id);
        if (staleIds.length > 0) {
          await tx.planWeek.deleteMany({
            where: { id: { in: staleIds }, planId: next.id },
          });
        }

        await tx.trainingPlan.update({
          where: { id: next.id },
          data: {
            raceDate: next.raceDate ? parseIsoDateAtNoon(next.raceDate) : null,
            taperDays: next.taperDays,
          },
        });
      });

      const reloaded = await loadActivePlan(userId);
      if (!reloaded) throw new Error("Plan missing after schedule save");
      return reloaded;
    },
  };
}

export async function activePlanRunningMiles(userId: string): Promise<number | null> {
  const plan = await loadActivePlan(userId);
  if (!plan) return null;
  return totalRunningMiles(plan.weeks);
}
