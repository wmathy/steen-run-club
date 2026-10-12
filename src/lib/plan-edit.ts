/**
 * Applies move / swap / shift operations to a stored plan.
 * The Plan tab dates workouts from week number + dayOfWeek, so the edit
 * has to change those fields or the athlete never sees it.
 */

import { MAX_PLAN_WEEKS } from "@/lib/validation";
import {
  absolutePlanDay,
  addIsoDays,
  dateForPlanSlot,
  mondayOf,
  planDayName,
  slotFromAbsolute,
} from "@/lib/plan-dates";
import type { StoredPlan, StoredWeek, StoredWorkout } from "@/lib/plan-model";

export type DayRef = {
  weekNumber: number;
  dayOfWeek: number;
};

export type ScheduleOperation =
  | {
      op: "move";
      from: DayRef & { title?: string };
      toWeekNumber: number;
      toDayOfWeek: number;
    }
  | {
      op: "swap";
      a: DayRef;
      b: DayRef;
    }
  | {
      op: "shift";
      weekNumber: number;
      dayOfWeek: number;
      title?: string;
      /** Positive moves later, negative moves earlier. */
      days: number;
    };

type Located = {
  weekNumber: number;
  workout: StoredWorkout;
};

export type ScheduleEditResult =
  | { ok: true; plan: StoredPlan; changes: string[] }
  | { ok: false; message: string };

function clonePlan(plan: StoredPlan): StoredPlan {
  return structuredClone(plan);
}

function sameDay(a: DayRef, b: DayRef): boolean {
  return a.weekNumber === b.weekNumber && a.dayOfWeek === b.dayOfWeek;
}

function dayLabel(weekNumber: number, dayOfWeek: number): string {
  return `week ${weekNumber} ${planDayName(dayOfWeek)}`;
}

function findMatches(
  plan: StoredPlan,
  ref: DayRef & { title?: string },
): Located[] {
  const title = ref.title?.trim().toLowerCase();
  const matches: Located[] = [];
  for (const week of plan.weeks) {
    if (week.weekNumber !== ref.weekNumber) continue;
    for (const workout of week.workouts) {
      if (workout.dayOfWeek !== ref.dayOfWeek) continue;
      if (title && workout.title.trim().toLowerCase() !== title) continue;
      matches.push({ weekNumber: week.weekNumber, workout });
    }
  }
  return matches;
}

function dayContents(plan: StoredPlan, ref: DayRef): string {
  const titles = findMatches(plan, {
    weekNumber: ref.weekNumber,
    dayOfWeek: ref.dayOfWeek,
  }).map((item) => item.workout.title);
  if (titles.length === 0) return "nothing scheduled";
  return titles.join(", ");
}

function ensureWeek(plan: StoredPlan, weekNumber: number): StoredWeek {
  const existing = plan.weeks.find((week) => week.weekNumber === weekNumber);
  if (existing) return existing;
  const created: StoredWeek = {
    weekNumber,
    focus: null,
    notes: null,
    workouts: [],
  };
  plan.weeks.push(created);
  plan.weeks.sort((a, b) => a.weekNumber - b.weekNumber);
  return created;
}

function place(
  plan: StoredPlan,
  workout: StoredWorkout,
  weekNumber: number,
  dayOfWeek: number,
) {
  for (const week of plan.weeks) {
    week.workouts = week.workouts.filter((item) => item.id !== workout.id);
  }
  const week = ensureWeek(plan, weekNumber);
  workout.dayOfWeek = dayOfWeek;
  workout.date = dateForPlanSlot(plan.startDate, weekNumber, dayOfWeek);
  week.workouts.push(workout);
  week.workouts.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function dropEmptyWeeks(plan: StoredPlan) {
  plan.weeks = plan.weeks.filter((week) => week.workouts.length > 0);
}

function slotError(weekNumber: number, dayOfWeek: number): string | null {
  if (weekNumber < 1) {
    return "That would move a workout before the plan starts. Nothing was changed.";
  }
  if (weekNumber > MAX_PLAN_WEEKS) {
    return `That would run past week ${MAX_PLAN_WEEKS}. Nothing was changed.`;
  }
  if (dayOfWeek < 0 || dayOfWeek > 6) {
    return "That day is outside Monday–Sunday. Nothing was changed.";
  }
  return null;
}

function syncRaceDate(plan: StoredPlan, changes: string[]) {
  if (!plan.raceDate) return;
  const races = plan.weeks.flatMap((week) =>
    week.workouts
      .filter((workout) => workout.type === "race")
      .map((workout) => workout.date)
      .filter((date): date is string => Boolean(date)),
  );
  if (races.includes(plan.raceDate)) return;
  if (races.length === 0) return;
  const next = [...races].sort().at(-1)!;
  const previous = plan.raceDate;
  plan.raceDate = next;
  const taper =
    plan.taperDays != null
      ? ` Taper stays ${plan.taperDays} days before the new race day.`
      : "";
  changes.push(`Race day moved from ${previous} to ${next}.${taper}`);
}

export function applyScheduleOperations(
  original: StoredPlan,
  operations: ScheduleOperation[],
): ScheduleEditResult {
  if (operations.length === 0) {
    return { ok: false, message: "No schedule change was provided." };
  }

  const plan = clonePlan(original);
  const changes: string[] = [];

  for (const operation of operations) {
    if (operation.op === "swap") {
      if (sameDay(operation.a, operation.b)) {
        return {
          ok: false,
          message: "Those are the same day, so there is nothing to swap.",
        };
      }
      const slotA = slotError(operation.a.weekNumber, operation.a.dayOfWeek);
      const slotB = slotError(operation.b.weekNumber, operation.b.dayOfWeek);
      if (slotA) return { ok: false, message: slotA };
      if (slotB) return { ok: false, message: slotB };

      const aMatches = findMatches(plan, operation.a);
      const bMatches = findMatches(plan, operation.b);
      if (aMatches.length === 0 && bMatches.length === 0) {
        return {
          ok: false,
          message: `Nothing is scheduled on ${dayLabel(operation.a.weekNumber, operation.a.dayOfWeek)} or ${dayLabel(operation.b.weekNumber, operation.b.dayOfWeek)}.`,
        };
      }
      const aTitles = aMatches.map((item) => item.workout.title).join(", ") || "rest";
      const bTitles = bMatches.map((item) => item.workout.title).join(", ") || "rest";
      for (const item of aMatches) {
        place(plan, item.workout, operation.b.weekNumber, operation.b.dayOfWeek);
      }
      for (const item of bMatches) {
        place(plan, item.workout, operation.a.weekNumber, operation.a.dayOfWeek);
      }
      changes.push(
        `Swapped ${dayLabel(operation.a.weekNumber, operation.a.dayOfWeek)} (${aTitles}) with ${dayLabel(operation.b.weekNumber, operation.b.dayOfWeek)} (${bTitles}).`,
      );
      continue;
    }

    if (operation.op === "move") {
      const destError = slotError(operation.toWeekNumber, operation.toDayOfWeek);
      if (destError) return { ok: false, message: destError };
      const matches = findMatches(plan, operation.from);
      if (matches.length === 0) {
        return {
          ok: false,
          message: operation.from.title
            ? `No workout titled "${operation.from.title}" on ${dayLabel(operation.from.weekNumber, operation.from.dayOfWeek)}. That day has: ${dayContents(plan, operation.from)}.`
            : `Nothing is scheduled on ${dayLabel(operation.from.weekNumber, operation.from.dayOfWeek)}.`,
        };
      }
      if (
        operation.from.weekNumber === operation.toWeekNumber &&
        operation.from.dayOfWeek === operation.toDayOfWeek
      ) {
        return {
          ok: false,
          message: `${matches.map((item) => item.workout.title).join(", ")} is already on ${dayLabel(operation.toWeekNumber, operation.toDayOfWeek)}. Nothing was changed.`,
        };
      }
      const titles = matches.map((item) => item.workout.title).join(", ");
      for (const item of matches) {
        place(plan, item.workout, operation.toWeekNumber, operation.toDayOfWeek);
      }
      changes.push(
        `Moved ${titles} from ${dayLabel(operation.from.weekNumber, operation.from.dayOfWeek)} to ${dayLabel(operation.toWeekNumber, operation.toDayOfWeek)}.`,
      );
      continue;
    }

    if (operation.days === 0) {
      return { ok: false, message: "A shift of 0 days does not change the plan." };
    }
    const matches = findMatches(plan, operation);
    if (matches.length === 0) {
      return {
        ok: false,
        message: operation.title
          ? `No workout titled "${operation.title}" on ${dayLabel(operation.weekNumber, operation.dayOfWeek)}. That day has: ${dayContents(plan, operation)}.`
          : `Nothing is scheduled on ${dayLabel(operation.weekNumber, operation.dayOfWeek)}.`,
      };
    }
    const fromLabel = dayLabel(operation.weekNumber, operation.dayOfWeek);
    for (const item of matches) {
      const nextAbs =
        absolutePlanDay(item.weekNumber, item.workout.dayOfWeek) + operation.days;
      if (nextAbs < 0) {
        return {
          ok: false,
          message: `Shifting "${item.workout.title}" by ${operation.days} days would put it before the plan starts. Nothing was changed.`,
        };
      }
      const next = slotFromAbsolute(nextAbs);
      const destError = slotError(next.weekNumber, next.dayOfWeek);
      if (destError) return { ok: false, message: destError };
      place(plan, item.workout, next.weekNumber, next.dayOfWeek);
      changes.push(
        `Shifted ${item.workout.title} by ${operation.days} day${operation.days === 1 || operation.days === -1 ? "" : "s"}, from ${fromLabel} to ${dayLabel(next.weekNumber, next.dayOfWeek)}.`,
      );
    }
  }

  dropEmptyWeeks(plan);
  syncRaceDate(plan, changes);

  if (plan.raceDate && plan.taperDays != null) {
    const gridStart = mondayOf(plan.startDate);
    const taperStart = addIsoDays(plan.raceDate, -plan.taperDays);
    if (taperStart < gridStart) {
      return {
        ok: false,
        message: `That change would put race day on ${plan.raceDate}, so the ${plan.taperDays}-day taper would start ${taperStart}, before this plan starts (${gridStart}). The plan was not changed. A race plan needs the full 10–14 day taper on the calendar.`,
      };
    }
  }

  return { ok: true, plan, changes };
}
