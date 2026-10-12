import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateForPlanSlot } from "@/lib/plan-dates";
import { handlePlanScheduleEdit, type PlanRepository } from "@/lib/plan-actions";
import type { StoredPlan, StoredWorkout } from "@/lib/plan-model";

function workout(
  id: string,
  dayOfWeek: number,
  title: string,
  type = "easy",
  extra: Partial<StoredWorkout> = {},
): StoredWorkout {
  return {
    id,
    dayOfWeek,
    date: null,
    type,
    title,
    description: null,
    distanceMiles: 4,
    durationMin: 40,
    targetPace: "easy",
    completed: false,
    completionStatus: null,
    ...extra,
  };
}

function samplePlan(): StoredPlan {
  return {
    id: "plan-1",
    title: "Base",
    goal: "Consistency",
    startDate: "2026-08-03",
    endDate: "2026-08-16",
    notes: null,
    raceDate: "2026-09-27",
    taperDays: 14,
    weeks: [
      {
        weekNumber: 1,
        focus: "Base",
        notes: null,
        workouts: [
          workout("easy-mon", 0, "Easy Monday", "easy", {
            completed: true,
            completionStatus: "as_planned",
          }),
          workout("tempo-wed", 2, "Tempo Wednesday", "tempo"),
          workout("long-sat", 5, "Long Saturday", "long", { distanceMiles: 8 }),
        ],
      },
      {
        weekNumber: 2,
        focus: "Base",
        notes: null,
        workouts: [workout("easy-fri", 4, "Easy Friday")],
      },
    ],
  };
}

function memoryRepo(initial: StoredPlan): PlanRepository & {
  current: () => StoredPlan | null;
} {
  let plan: StoredPlan | null = structuredClone(initial);
  return {
    current: () => (plan ? structuredClone(plan) : null),
    async loadActive() {
      return plan ? structuredClone(plan) : null;
    },
    async saveSchedule(_userId, next) {
      plan = structuredClone(next);
      return structuredClone(next);
    },
  };
}

function findWorkout(plan: StoredPlan, id: string) {
  for (const week of plan.weeks) {
    for (const item of week.workouts) {
      if (item.id === id) return { weekNumber: week.weekNumber, workout: item };
    }
  }
  return null;
}

describe("plan schedule edits", () => {
  it("moves a workout onto the requested day and keeps it completed", async () => {
    const repo = memoryRepo(samplePlan());
    const result = await handlePlanScheduleEdit({
      repo,
      userId: "user-1",
      mode: "interactive",
      userText: "Can you move my Monday easy run to Tuesday?",
      operations: [
        {
          op: "move",
          from: { weekNumber: 1, dayOfWeek: 0, title: "Easy Monday" },
          toWeekNumber: 1,
          toDayOfWeek: 1,
        },
      ],
    });

    assert.equal(result.success, true, result.success ? "" : result.message);
    const stored = repo.current();
    assert.ok(stored);
    const moved = findWorkout(stored, "easy-mon");
    assert.ok(moved);
    assert.equal(moved.weekNumber, 1);
    assert.equal(moved.workout.dayOfWeek, 1);
    assert.equal(moved.workout.completed, true);
    assert.equal(moved.workout.completionStatus, "as_planned");
    assert.equal(
      moved.workout.date,
      dateForPlanSlot(stored.startDate, 1, 1),
    );
    assert.equal(findWorkout(stored, "tempo-wed")?.workout.dayOfWeek, 2);
  });

  it("names the workouts on a day when the title does not match", async () => {
    const repo = memoryRepo(samplePlan());
    const result = await handlePlanScheduleEdit({
      repo,
      userId: "user-1",
      mode: "interactive",
      userText: "Move Monday's tempo to Tuesday",
      operations: [
        {
          op: "move",
          from: { weekNumber: 1, dayOfWeek: 0, title: "Tempo" },
          toWeekNumber: 1,
          toDayOfWeek: 1,
        },
      ],
    });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /Easy Monday/);
    assert.equal(findWorkout(repo.current()!, "easy-mon")?.workout.dayOfWeek, 0);
  });

  it("swaps two days", async () => {
    const repo = memoryRepo(samplePlan());
    const result = await handlePlanScheduleEdit({
      repo,
      userId: "user-1",
      mode: "interactive",
      userText: "Swap Monday and Wednesday this week",
      operations: [
        {
          op: "swap",
          a: { weekNumber: 1, dayOfWeek: 0 },
          b: { weekNumber: 1, dayOfWeek: 2 },
        },
      ],
    });

    assert.equal(result.success, true, result.success ? "" : result.message);
    const stored = repo.current();
    assert.ok(stored);
    assert.equal(findWorkout(stored, "easy-mon")?.workout.dayOfWeek, 2);
    assert.equal(findWorkout(stored, "tempo-wed")?.workout.dayOfWeek, 0);
  });

  it("shifts a workout into the next week", async () => {
    const repo = memoryRepo(samplePlan());
    const result = await handlePlanScheduleEdit({
      repo,
      userId: "user-1",
      mode: "interactive",
      userText: "Shift my long run 2 days later",
      operations: [
        {
          op: "shift",
          weekNumber: 1,
          dayOfWeek: 5,
          title: "Long Saturday",
          days: 2,
        },
      ],
    });

    assert.equal(result.success, true, result.success ? "" : result.message);
    const stored = repo.current();
    assert.ok(stored);
    const shifted = findWorkout(stored, "long-sat");
    assert.ok(shifted);
    assert.equal(shifted.weekNumber, 2);
    assert.equal(shifted.workout.dayOfWeek, 0);
    assert.equal(shifted.workout.title, "Long Saturday");
  });

  it("does not change the stored plan when the athlete only missed a workout", async () => {
    const repo = memoryRepo(samplePlan());
    const before = JSON.stringify(repo.current());
    const result = await handlePlanScheduleEdit({
      repo,
      userId: "user-1",
      mode: "interactive",
      userText: "I missed my long run",
      operations: [
        {
          op: "move",
          from: { weekNumber: 1, dayOfWeek: 5, title: "Long Saturday" },
          toWeekNumber: 1,
          toDayOfWeek: 6,
        },
      ],
    });

    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /optional/i);
    assert.equal(JSON.stringify(repo.current()), before);
  });

  it("applies a move the athlete asked for after missing a day", async () => {
    const repo = memoryRepo(samplePlan());
    const result = await handlePlanScheduleEdit({
      repo,
      userId: "user-1",
      mode: "interactive",
      userText: "I missed Tuesday. Can you move Wednesday's tempo to Friday?",
      operations: [
        {
          op: "move",
          from: { weekNumber: 1, dayOfWeek: 2, title: "Tempo Wednesday" },
          toWeekNumber: 1,
          toDayOfWeek: 4,
        },
      ],
    });

    assert.equal(result.success, true, result.success ? "" : result.message);
    const stored = repo.current();
    assert.ok(stored);
    assert.equal(findWorkout(stored, "tempo-wed")?.workout.dayOfWeek, 4);
  });

  it("refuses a race move that would start the taper before the plan", async () => {
    const raceDate = dateForPlanSlot("2026-08-03", 3, 6);
    const repo = memoryRepo({
      ...samplePlan(),
      startDate: "2026-08-03",
      raceDate,
      taperDays: 14,
      weeks: [
        {
          weekNumber: 3,
          focus: "Taper",
          notes: null,
          workouts: [
            workout("race", 6, "Goal race", "race", {
              distanceMiles: 13.1,
              date: raceDate,
            }),
          ],
        },
      ],
    });
    // 14 days before week-3 Sunday still sits inside the plan. Moving the
    // race to week-1 Monday pulls the taper start before week 1.
    const before = repo.current();
    const result = await handlePlanScheduleEdit({
      repo,
      userId: "user-1",
      mode: "interactive",
      userText: "Move my race to Monday",
      operations: [
        {
          op: "move",
          from: { weekNumber: 3, dayOfWeek: 6, title: "Goal race" },
          toWeekNumber: 1,
          toDayOfWeek: 0,
        },
      ],
    });

    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /taper/i);
    assert.equal(findWorkout(repo.current()!, "race")?.workout.dayOfWeek, 6);
    assert.equal(repo.current()?.raceDate, before?.raceDate);
  });
});
