/**
 * Applies move / swap / shift / update operations to a stored plan.
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
  slotForDate,
  slotFromAbsolute,
} from "@/lib/plan-dates";
import type { StoredPlan, StoredWeek, StoredWorkout } from "@/lib/plan-model";
import { weekRunningMiles } from "@/lib/plan-rules";

export type DayRef = {
  weekNumber: number;
  dayOfWeek: number;
};

export type WorkoutPatch = {
  type?: string;
  title?: string;
  description?: string | null;
  distanceMiles?: number | null;
  durationMin?: number | null;
  targetPace?: string | null;
  effortLevel?: string | null;
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
    }
  | {
      op: "update";
      weekNumber?: number;
      dayOfWeek?: number;
      /** Calendar day. Wins over weekNumber + dayOfWeek when both are set. */
      date?: string;
      /** Current title, when the day has more than one workout. */
      matchTitle?: string;
      /** Replace every workout on that day with this one. */
      replace?: boolean;
      patch: WorkoutPatch;
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

function milesLabel(miles: number | null | undefined): string {
  const n = typeof miles === "number" && Number.isFinite(miles) ? miles : 0;
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function weekTotalLabel(plan: StoredPlan, weekNumber: number): string {
  const week = plan.weeks.find((item) => item.weekNumber === weekNumber);
  const total = week ? weekRunningMiles(week.workouts) : 0;
  return `Week ${weekNumber} total is now ${milesLabel(total)} miles.`;
}

function resolveUpdateDay(
  plan: StoredPlan,
  operation: Extract<ScheduleOperation, { op: "update" }>,
): { ok: true; ref: DayRef } | { ok: false; message: string } {
  if (operation.date) {
    const slot = slotForDate(plan.startDate, operation.date);
    if (!slot) {
      return {
        ok: false,
        message: `${operation.date} is before this plan starts (${plan.startDate}). Nothing was changed.`,
      };
    }
    const err = slotError(slot.weekNumber, slot.dayOfWeek);
    if (err) return { ok: false, message: err };
    return { ok: true, ref: slot };
  }
  if (operation.weekNumber == null || operation.dayOfWeek == null) {
    return {
      ok: false,
      message: "Name the week and day to update, or send a date. Nothing was changed.",
    };
  }
  const err = slotError(operation.weekNumber, operation.dayOfWeek);
  if (err) return { ok: false, message: err };
  return {
    ok: true,
    ref: { weekNumber: operation.weekNumber, dayOfWeek: operation.dayOfWeek },
  };
}

function patchWorkout(workout: StoredWorkout, patch: WorkoutPatch): string[] {
  const notes: string[] = [];
  if (patch.type != null && patch.type !== workout.type) {
    notes.push(`type ${workout.type} → ${patch.type}`);
    workout.type = patch.type;
  }
  if (patch.title != null && patch.title !== workout.title) {
    notes.push(`title "${workout.title}" → "${patch.title}"`);
    workout.title = patch.title;
  }
  if (
    patch.description !== undefined &&
    (patch.description ?? null) !== (workout.description ?? null)
  ) {
    workout.description = patch.description;
    notes.push("description");
  }
  if (
    patch.distanceMiles !== undefined &&
    (patch.distanceMiles ?? null) !== (workout.distanceMiles ?? null)
  ) {
    notes.push(
      `distance ${milesLabel(workout.distanceMiles)} → ${milesLabel(patch.distanceMiles)} mi`,
    );
    workout.distanceMiles = patch.distanceMiles;
  }
  if (
    patch.durationMin !== undefined &&
    (patch.durationMin ?? null) !== (workout.durationMin ?? null)
  ) {
    notes.push(
      `duration ${milesLabel(workout.durationMin)} → ${milesLabel(patch.durationMin)} min`,
    );
    workout.durationMin = patch.durationMin;
  }
  if (
    patch.targetPace !== undefined &&
    (patch.targetPace ?? null) !== (workout.targetPace ?? null)
  ) {
    workout.targetPace = patch.targetPace;
    notes.push("pace");
  }
  if (
    patch.effortLevel !== undefined &&
    (patch.effortLevel ?? null) !== (workout.effortLevel ?? null)
  ) {
    notes.push(patch.effortLevel ? `effort ${patch.effortLevel}` : "effort cleared");
    workout.effortLevel = patch.effortLevel;
  }
  return notes;
}

function insertWorkout(
  plan: StoredPlan,
  ref: DayRef,
  patch: WorkoutPatch & { title: string },
): StoredWorkout {
  const workout: StoredWorkout = {
    id: `edit_${crypto.randomUUID()}`,
    dayOfWeek: ref.dayOfWeek,
    date: dateForPlanSlot(plan.startDate, ref.weekNumber, ref.dayOfWeek),
    type: patch.type ?? "easy",
    title: patch.title,
    description: patch.description ?? null,
    distanceMiles: patch.distanceMiles ?? null,
    durationMin: patch.durationMin ?? null,
    targetPace: patch.targetPace ?? null,
    effortLevel: patch.effortLevel ?? null,
    completed: false,
    completionStatus: null,
  };
  const week = ensureWeek(plan, ref.weekNumber);
  week.workouts.push(workout);
  week.workouts.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return workout;
}

function clearDay(plan: StoredPlan, ref: DayRef) {
  for (const week of plan.weeks) {
    if (week.weekNumber !== ref.weekNumber) continue;
    week.workouts = week.workouts.filter((workout) => workout.dayOfWeek !== ref.dayOfWeek);
  }
}

function workoutSummary(workout: StoredWorkout): string {
  const miles =
    workout.distanceMiles != null ? `, ${milesLabel(workout.distanceMiles)} mi` : "";
  const effort = workout.effortLevel ? `, ${workout.effortLevel}` : "";
  return `${workout.type}${miles}${effort}`;
}

function applyUpdateOperation(
  plan: StoredPlan,
  operation: Extract<ScheduleOperation, { op: "update" }>,
  changes: string[],
): string | null {
  const resolved = resolveUpdateDay(plan, operation);
  if (!resolved.ok) return resolved.message;
  const ref = resolved.ref;
  const dayWorkouts = findMatches(plan, ref);

  if (operation.replace) {
    const title = operation.patch.title ?? operation.matchTitle;
    if (!title) {
      return "Name the workout when replacing a day. Nothing was changed.";
    }
    clearDay(plan, ref);
    const created = insertWorkout(plan, ref, { ...operation.patch, title });
    changes.push(
      `Replaced ${dayLabel(ref.weekNumber, ref.dayOfWeek)} with ${created.title} (${workoutSummary(created)}). ${weekTotalLabel(plan, ref.weekNumber)}`,
    );
    return null;
  }

  let matches: Located[] = [];
  if (operation.matchTitle) {
    matches = findMatches(plan, { ...ref, title: operation.matchTitle });
    if (matches.length === 0 && dayWorkouts.length > 0) {
      return `No workout titled "${operation.matchTitle}" on ${dayLabel(ref.weekNumber, ref.dayOfWeek)}. That day has: ${dayContents(plan, ref)}. Nothing was changed.`;
    }
  } else if (operation.patch.title) {
    const titled = findMatches(plan, { ...ref, title: operation.patch.title });
    if (titled.length > 0) matches = titled;
    else if (dayWorkouts.length <= 1) matches = dayWorkouts;
  } else if (dayWorkouts.length === 1) {
    matches = dayWorkouts;
  } else if (dayWorkouts.length > 1) {
    return `Several workouts are on ${dayLabel(ref.weekNumber, ref.dayOfWeek)} (${dayWorkouts.map((item) => item.workout.title).join(", ")}). Name the one to update. Nothing was changed.`;
  }

  if (matches.length === 0) {
    const title = operation.patch.title ?? operation.matchTitle;
    if (!title) {
      return `Nothing is scheduled on ${dayLabel(ref.weekNumber, ref.dayOfWeek)}. Name the workout to add. Nothing was changed.`;
    }
    const created = insertWorkout(plan, ref, { ...operation.patch, title });
    changes.push(
      `Added ${created.title} on ${dayLabel(ref.weekNumber, ref.dayOfWeek)} (${workoutSummary(created)}). ${weekTotalLabel(plan, ref.weekNumber)}`,
    );
    return null;
  }

  const notes: string[] = [];
  for (const item of matches) {
    const before = item.workout.title;
    const detail = patchWorkout(item.workout, operation.patch);
    item.workout.date = dateForPlanSlot(plan.startDate, ref.weekNumber, ref.dayOfWeek);
    notes.push(detail.length > 0 ? `${before} (${detail.join(", ")})` : before);
  }
  changes.push(
    `Updated ${notes.join("; ")} on ${dayLabel(ref.weekNumber, ref.dayOfWeek)}. ${weekTotalLabel(plan, ref.weekNumber)}`,
  );
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

    if (operation.op === "update") {
      const message = applyUpdateOperation(plan, operation, changes);
      if (message) return { ok: false, message };
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
