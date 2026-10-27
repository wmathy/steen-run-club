import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://steen:steen@127.0.0.1:5432/steen_test?sslmode=disable";

const header = {
  title: "5K Sub-18 Block (Post-Hixon)",
  startDate: "2026-10-26",
  reason: "new_plan" as const,
  goal: "5K under 18:00 by ~Jan 1 2027",
  endDate: "2027-01-01",
  raceDate: "2027-01-01",
  taperDays: 12,
  notes: "Less volume, more intensity.",
  replaceActive: true,
};

describe("save_or_update_plan weeks", () => {
  it("returns a tool error instead of a schema failure when weeks is omitted", async () => {
    const { asSchema } = await import("ai");
    const { createCoachTools, SAVE_PLAN_WEEKS_REQUIRED } = await import(
      "@/lib/tools"
    );
    const saveTool = createCoachTools("user-test").save_or_update_plan;
    const schema = asSchema(saveTool.inputSchema);
    assert.equal(typeof schema.validate, "function");

    let thrown: unknown = null;
    let validated: Awaited<ReturnType<NonNullable<typeof schema.validate>>> | null =
      null;
    try {
      validated = await schema.validate!(header);
    } catch (err) {
      thrown = err;
    }
    assert.equal(thrown, null);
    assert.equal(validated?.success, true);
    if (!validated?.success) return;

    const execute = saveTool.execute;
    assert.ok(execute);
    const result = await execute(validated.value, {
      toolCallId: "missing-weeks",
      messages: [],
      context: {},
    });
    assert.ok(result && typeof result === "object" && "success" in result);
    assert.equal(result.success, false);
    assert.equal(
      "error" in result ? result.error : undefined,
      SAVE_PLAN_WEEKS_REQUIRED,
    );
  });

  it("returns the same tool error when weeks is empty", async () => {
    const { asSchema } = await import("ai");
    const { createCoachTools, SAVE_PLAN_WEEKS_REQUIRED } = await import(
      "@/lib/tools"
    );
    const saveTool = createCoachTools("user-test").save_or_update_plan;
    const schema = asSchema(saveTool.inputSchema);
    const validated = await schema.validate!({ ...header, weeks: [] });
    assert.equal(
      validated.success,
      true,
      validated.success ? "" : validated.error.message,
    );
    if (!validated.success) return;
    const execute = saveTool.execute;
    assert.ok(execute);
    const result = await execute(validated.value, {
      toolCallId: "empty-weeks",
      messages: [],
      context: {},
    });
    assert.ok(result && typeof result === "object" && "success" in result);
    assert.equal(result.success, false);
    assert.equal(
      "error" in result ? result.error : undefined,
      SAVE_PLAN_WEEKS_REQUIRED,
    );
  });
});

const POST_HIXON_NOTES =
  "5 run days: Mon easy+lift, Tue off BJJ, Wed quality (only hard session), Thu easy+lift, Fri rest BJJ, Sat longer easy, Sun easy/recovery. Peak ~28–35 mpw. W1–2 recovery/rebuild only.";

function postHixonWeeks() {
  const specs: Array<{
    mon: number;
    wed: [string, number];
    thu: number;
    sat: [string, number];
    sun: number;
  }> = [
    { mon: 3, wed: ["aerobic", 3], thu: 2, sat: ["easy", 4], sun: 0 },
    { mon: 4, wed: ["jog", 4], thu: 3, sat: ["easy", 5], sun: 2 },
    { mon: 4, wed: ["threshold", 5], thu: 4, sat: ["long_run", 8], sun: 3 },
    { mon: 5, wed: ["cruise", 5], thu: 4, sat: ["long_run", 10], sun: 4 },
    { mon: 5, wed: ["vo2", 6], thu: 5, sat: ["long_run", 11], sun: 5 },
    { mon: 6, wed: ["steady", 6], thu: 5, sat: ["long_run", 12], sun: 5 },
    { mon: 5, wed: ["fartlek", 5], thu: 4, sat: ["long_run", 11], sun: 5 },
    { mon: 4, wed: ["easy", 3], thu: 3, sat: ["long_run", 8], sun: 3 },
    { mon: 3, wed: ["easy", 3], thu: 2, sat: ["easy", 3], sun: 0 },
    { mon: 2, wed: ["easy", 2], thu: 0, sat: ["rest", 0], sun: 0 },
  ];

  return specs.map((spec, index) => {
    const weekNumber = index + 1;
    const workouts: Array<Record<string, unknown>> = [
      {
        dayOfWeek: 0,
        date: null,
        type: "recovery",
        title: `Easy ${weekNumber}`,
        description: null,
        distanceMiles: spec.mon,
        durationMin: null,
        targetPace: null,
      },
      {
        dayOfWeek: 0,
        date: null,
        type: "lift",
        title: `Lift ${weekNumber}`,
        description: null,
        distanceMiles: 0,
        durationMin: 0,
        targetPace: "",
      },
      {
        dayOfWeek: 1,
        date: null,
        type: "bjj",
        title: `BJJ ${weekNumber}`,
        description: null,
        distanceMiles: 0,
        durationMin: 0,
        targetPace: null,
      },
      {
        dayOfWeek: 2,
        date: null,
        type: spec.wed[0],
        title: `Midweek ${weekNumber}`,
        description: null,
        distanceMiles: spec.wed[1],
        durationMin: null,
        targetPace: null,
      },
      {
        dayOfWeek: 3,
        date: null,
        type: "easy",
        title: `Easy Thu ${weekNumber}`,
        description: "",
        distanceMiles: spec.thu,
        durationMin: null,
        targetPace: null,
      },
      {
        dayOfWeek: 3,
        date: null,
        type: "gym",
        title: `Gym ${weekNumber}`,
        description: null,
        distanceMiles: 0,
        durationMin: 40,
        targetPace: null,
      },
      {
        dayOfWeek: 4,
        date: null,
        type: "off",
        title: `Rest ${weekNumber}`,
        description: null,
        distanceMiles: 0,
        durationMin: 0,
        targetPace: null,
      },
      {
        dayOfWeek: 5,
        date: null,
        type: spec.sat[0],
        title: `Saturday ${weekNumber}`,
        description: null,
        distanceMiles: spec.sat[1],
        durationMin: null,
        targetPace: null,
      },
      {
        dayOfWeek: 7,
        date: null,
        type: "recovery",
        title: `Sunday ${weekNumber}`,
        description: null,
        distanceMiles: spec.sun,
        durationMin: null,
        targetPace: null,
      },
    ];
    if (weekNumber === 10) {
      workouts.splice(
        workouts.findIndex((workout) => workout.dayOfWeek === 4),
        1,
        {
          dayOfWeek: 5,
          date: "2027-01-01T12:00:00.000Z",
          type: "5k",
          title: "Sub-18 5K",
          description: null,
          distanceMiles: 3.1,
          durationMin: null,
          targetPace: null,
        },
      );
    }
    return {
      weekNumber,
      focus: null,
      notes: null,
      workouts,
    };
  });
}

function postHixonPlan(taperDays: number | null) {
  return {
    title: "Sub-18 5K Block (Post-Hixon)",
    goal: null,
    startDate: "2026-10-26",
    endDate: "2027-01-01",
    raceDate: "2027-01-01",
    taperDays,
    notes: POST_HIXON_NOTES,
    replaceActive: null,
    weeks: postHixonWeeks(),
  };
}

async function executeSave(payload: unknown, toolCallId: string) {
  const { asSchema } = await import("ai");
  const { createCoachTools } = await import("@/lib/tools");
  const stored: {
    plan: {
      title: string;
      raceDate?: string | null;
      taperDays?: number | null;
      weeks: Array<{
        workouts: Array<{
          type: string;
          title: string;
          dayOfWeek: number;
          date?: string | null;
          distanceMiles?: number | null;
          durationMin?: number | null;
        }>;
      }>;
    } | null;
  } = { plan: null };
  const saveTool = createCoachTools("user-test", {
    userText: "Build the 10-week sub-18 5K plan",
    persistPlan: async (plan) => {
      stored.plan = plan;
      return {
        id: "plan-1",
        title: plan.title,
        weeks: plan.weeks.map((week) => ({ workouts: week.workouts })),
      };
    },
  }).save_or_update_plan;
  const schema = asSchema(saveTool.inputSchema);
  let thrown: unknown = null;
  let validated: Awaited<ReturnType<NonNullable<typeof schema.validate>>> | null =
    null;
  try {
    validated = await schema.validate!(payload);
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, null);
  assert.equal(
    validated?.success,
    true,
    validated && !validated.success ? validated.error.message : "",
  );
  if (!validated?.success) return { result: null, stored: stored.plan };
  const execute = saveTool.execute;
  assert.ok(execute);
  const result = await execute(validated.value, {
    toolCallId,
    messages: [],
    context: {},
  });
  return { result, stored: stored.plan };
}

describe("save_or_update_plan permissive input", () => {
  it("saves on the first try when reason is omitted and optional fields are null", async () => {
    const { result, stored } = await executeSave(
      {
        title: "Easy week",
        goal: null,
        startDate: "2026-10-26T05:00:00.000Z",
        endDate: null,
        raceDate: null,
        taperDays: null,
        notes: "",
        replaceActive: null,
        weeks: [
          {
            weekNumber: 1,
            focus: null,
            notes: null,
            workouts: [
              {
                dayOfWeek: 0,
                date: null,
                type: "recovery",
                title: "Shakeout",
                description: null,
                distanceMiles: 4,
                durationMin: null,
                targetPace: "",
              },
              {
                dayOfWeek: 1,
                date: null,
                type: "rest",
                title: "Rest",
                description: "",
                distanceMiles: 0,
                durationMin: 0,
                targetPace: null,
              },
              {
                dayOfWeek: 3,
                date: null,
                type: "strength",
                title: "Lift",
                description: null,
                distanceMiles: -1,
                durationMin: 0,
                targetPace: null,
              },
              {
                dayOfWeek: 7,
                date: null,
                type: "off",
                title: "Off",
                description: null,
                distanceMiles: null,
                durationMin: null,
                targetPace: null,
              },
            ],
          },
        ],
      },
      "missing-reason",
    );
    assert.ok(result && typeof result === "object" && "success" in result);
    assert.equal(
      result.success,
      true,
      result && "message" in result ? String(result.message) : "",
    );
    assert.ok(stored);
    const workouts = stored.weeks.flatMap((week) => week.workouts);
    assert.equal(workouts.find((workout) => workout.title === "Shakeout")?.type, "easy");
    assert.equal(workouts.find((workout) => workout.title === "Rest")?.distanceMiles ?? null, null);
    assert.equal(workouts.find((workout) => workout.title === "Lift")?.distanceMiles ?? null, null);
    assert.equal(workouts.find((workout) => workout.title === "Lift")?.durationMin ?? null, null);
    assert.equal(workouts.find((workout) => workout.title === "Off")?.type, "rest");
    assert.equal(workouts.find((workout) => workout.title === "Off")?.dayOfWeek, 6);
  });

  it("saves the 10-week Sub-18 5K Block (Post-Hixon) on the first attempt", async () => {
    const { result, stored } = await executeSave(postHixonPlan(12), "post-hixon");
    assert.ok(result && typeof result === "object" && "success" in result);
    assert.equal(
      result.success,
      true,
      result && "message" in result ? String(result.message) : "",
    );
    assert.ok(stored);
    assert.equal(stored.title, "Sub-18 5K Block (Post-Hixon)");
    assert.equal(stored.weeks.length, 10);
    assert.equal(stored.raceDate, "2027-01-01");
    assert.equal(stored.taperDays, 12);
    const race = stored.weeks
      .flatMap((week) => week.workouts)
      .find((workout) => workout.title === "Sub-18 5K");
    assert.equal(race?.type, "race");
    assert.equal(race?.date, "2027-01-01");
    assert.equal(race?.dayOfWeek, 4);
    const easy = stored.weeks[0]?.workouts.find((workout) => workout.title === "Easy 1");
    assert.equal(easy?.type, "easy");
    const lift = stored.weeks[0]?.workouts.find((workout) => workout.title === "Lift 1");
    assert.equal(lift?.distanceMiles ?? null, null);
  });

  it("clamps an omitted or short taper instead of rejecting the same block", async () => {
    const omitted = await executeSave(postHixonPlan(null), "taper-omitted");
    assert.equal(
      omitted.result && "success" in omitted.result ? omitted.result.success : false,
      true,
      omitted.result && "message" in omitted.result ? String(omitted.result.message) : "",
    );
    assert.equal(omitted.stored?.taperDays, 12);

    const short = await executeSave(postHixonPlan(7), "taper-short");
    assert.equal(
      short.result && "success" in short.result ? short.result.success : false,
      true,
      short.result && "message" in short.result ? String(short.result.message) : "",
    );
    assert.equal(short.stored?.taperDays, 10);
  });

  it("accepts null reason and a Sunday sent as day 7 on edit_plan_schedule", async () => {
    const { asSchema } = await import("ai");
    const { createCoachTools } = await import("@/lib/tools");
    const editTool = createCoachTools("user-test").edit_plan_schedule;
    const schema = asSchema(editTool.inputSchema);
    let thrown: unknown = null;
    let validated: Awaited<ReturnType<NonNullable<typeof schema.validate>>> | null =
      null;
    try {
      validated = await schema.validate!({
        reason: null,
        operations: [
          {
            op: "move",
            from: { weekNumber: 1, dayOfWeek: 7, title: null },
            toWeekNumber: 1,
            toDayOfWeek: 0,
          },
        ],
      });
    } catch (err) {
      thrown = err;
    }
    assert.equal(thrown, null);
    assert.equal(validated?.success, true);
    if (!validated?.success) return;
    const { normalizeScheduleEditInput } = await import("@/lib/tools");
    const normalized = normalizeScheduleEditInput(validated.value);
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;
    assert.equal(normalized.reason, "schedule_edit");
    assert.equal(normalized.operations[0]?.op, "move");
    if (normalized.operations[0]?.op !== "move") return;
    assert.equal(normalized.operations[0].from.dayOfWeek, 6);
    assert.equal(normalized.operations[0].from.title, undefined);
  });

  it("accepts null optional fields on save_run", async () => {
    const { asSchema } = await import("ai");
    const { createCoachTools } = await import("@/lib/tools");
    const runTool = createCoachTools("user-test").save_run;
    const schema = asSchema(runTool.inputSchema);
    const validated = await schema.validate!({
      date: "2026-10-26T15:00:00.000Z",
      distanceMiles: 4,
      durationMin: null,
      type: "easy",
      notes: null,
      perceivedEffort: null,
    });
    assert.equal(
      validated.success,
      true,
      validated.success ? "" : validated.error.message,
    );
  });
});
