import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateForPlanSlot, mondayOf } from "@/lib/plan-dates";
import { buildCoachSystemPrompt } from "@/lib/coach-prompt";
import {
  EASY_TYPES,
  RUNNING_TYPES,
  type PlanDraft,
  type PlanWeekDraft,
  type PlanWorkoutDraft,
} from "@/lib/plan-model";
import {
  MAX_TAPER_DAYS,
  MIN_TAPER_DAYS,
  phaseOnDate,
  phaseSpans,
  planRulesForPrompt,
  preparePlanForSave,
} from "@/lib/plan-rules";
import { handlePlanSave } from "@/lib/plan-actions";

const START = "2026-08-03";

function workout(
  dayOfWeek: number,
  type: string,
  title: string,
  distanceMiles?: number,
): PlanWorkoutDraft {
  return {
    dayOfWeek,
    type,
    title,
    distanceMiles,
    targetPace: type === "rest" ? undefined : "easy",
  };
}

function issuesOf(draft: PlanDraft) {
  const result = preparePlanForSave(draft);
  return result.ok ? [] : result.issues;
}

function codes(draft: PlanDraft): string[] {
  return issuesOf(draft).map((issue) => issue.code);
}

/**
 * Eight Monday-weeks ending on a Sunday race.
 * Load steps up, then cuts back, and the taper window stays easy.
 */
function racePlan(taperDays: number): PlanDraft {
  assert.equal(mondayOf(START), START);
  const raceDate = dateForPlanSlot(START, 8, 6);
  const spans = phaseSpans(START, raceDate, taperDays);
  const longByWeek = [6, 6, 7, 8, 9, 8, 5, 4];
  const weeks: PlanWeekDraft[] = [];

  for (let weekNumber = 1; weekNumber <= 8; weekNumber += 1) {
    const workouts: PlanWorkoutDraft[] = [];
    const mondayMiles = weekNumber <= 2 ? 4 : 5;
    const slots: Array<[number, string, string, number]> = [
      [0, "easy", `Easy ${weekNumber} Mon`, mondayMiles],
      [2, "easy", `Easy ${weekNumber} Wed`, weekNumber <= 2 ? 4 : 5],
      [3, "tempo", `Tempo ${weekNumber}`, 3],
      [5, "long", `Long ${weekNumber}`, longByWeek[weekNumber - 1]],
    ];

    for (const [day, type, title, miles] of slots) {
      const iso = dateForPlanSlot(START, weekNumber, day);
      const phase = phaseOnDate(iso, raceDate, spans);
      if (phase === "race") {
        workouts.push(
          workout(day, "race", "Goal race", 13.1),
        );
        continue;
      }
      if (phase === "taper" || phase == null) {
        if (day === 0 || day === 2 || day === 4) {
          workouts.push(workout(day, "easy", `Shakeout ${weekNumber}-${day}`, 3));
        }
        continue;
      }
      if (type === "tempo" && weekNumber > 6) continue;
      workouts.push(workout(day, type, title, miles));
    }

    const raceIso = dateForPlanSlot(START, weekNumber, 6);
    if (raceIso === raceDate) {
      workouts.push(workout(6, "race", "Goal race", 13.1));
    }

    weeks.push({ weekNumber, workouts });
  }

  return {
    title: "Half marathon build",
    goal: "Finish healthy",
    startDate: START,
    raceDate,
    taperDays,
    weeks,
  };
}

describe("taper length", () => {
  it("rejects a taper shorter than 10 days", () => {
    const draft = racePlan(MIN_TAPER_DAYS);
    draft.taperDays = 9;
    assert.ok(codes(draft).includes("taper_length"));
  });

  it("rejects a taper longer than 14 days", () => {
    const draft = racePlan(MAX_TAPER_DAYS);
    draft.taperDays = 15;
    assert.ok(codes(draft).includes("taper_length"));
  });

  it("accepts a 10-day taper on a progressive race plan", () => {
    const result = preparePlanForSave(racePlan(10));
    assert.equal(
      result.ok,
      true,
      result.ok ? "" : result.issues.map((issue) => issue.message).join("\n"),
    );
    if (result.ok) assert.equal(result.plan.taperDays, 10);
  });

  it("accepts a 14-day taper and labels base, build, peak, and taper", () => {
    const result = preparePlanForSave(racePlan(14));
    assert.equal(
      result.ok,
      true,
      result.ok ? "" : result.issues.map((issue) => issue.message).join("\n"),
    );
    if (!result.ok) return;
    assert.equal(result.plan.taperDays, 14);
    const focuses = result.plan.weeks.map((week) => week.focus ?? "").join(" | ");
    assert.match(focuses, /Base/);
    assert.match(focuses, /Build/);
    assert.match(focuses, /Peak/);
    assert.match(focuses, /Taper/);
  });

  it("requires a race workout when a race date is set", () => {
    const draft = racePlan(14);
    for (const week of draft.weeks) {
      week.workouts = week.workouts.filter((item) => item.type !== "race");
    }
    assert.ok(codes(draft).includes("taper_race_missing"));
  });
});

describe("progressive load", () => {
  it("rejects a mileage jump over 20%", () => {
    const draft: PlanDraft = {
      title: "Too fast",
      startDate: START,
      weeks: [
        {
          weekNumber: 1,
          workouts: [workout(0, "easy", "Easy", 10), workout(5, "long", "Long", 6)],
        },
        {
          weekNumber: 2,
          workouts: [workout(0, "easy", "Easy", 16), workout(5, "long", "Long", 8)],
        },
      ],
    };
    assert.ok(codes(draft).includes("mileage_ramp"));
  });

  it("rejects a long run that jumps too far", () => {
    const draft: PlanDraft = {
      title: "Long jump",
      startDate: START,
      weeks: [
        {
          weekNumber: 1,
          workouts: [workout(0, "easy", "Easy", 8), workout(5, "long", "Long", 6)],
        },
        {
          weekNumber: 2,
          workouts: [workout(0, "easy", "Easy", 8), workout(5, "long", "Long", 10)],
        },
      ],
    };
    assert.ok(codes(draft).includes("long_run_jump"));
  });

  it("rejects back-to-back hard days", () => {
    const draft: PlanDraft = {
      title: "Stacked",
      startDate: START,
      weeks: [
        {
          weekNumber: 1,
          workouts: [
            workout(0, "easy", "Easy", 6),
            workout(3, "tempo", "Tempo", 4),
            workout(4, "long", "Long", 8),
          ],
        },
      ],
    };
    assert.ok(codes(draft).includes("stacked_stress"));
  });

  it("rejects a week that is mostly quality", () => {
    const draft: PlanDraft = {
      title: "Too hard",
      startDate: START,
      weeks: [
        {
          weekNumber: 1,
          workouts: [
            workout(0, "tempo", "Tempo", 6),
            workout(2, "interval", "Intervals", 5),
            workout(5, "easy", "Easy", 2),
          ],
        },
      ],
    };
    assert.ok(codes(draft).includes("easy_share"));
  });

  it("rejects four mileage increases in a row", () => {
    const miles = [10, 11, 12, 13, 14];
    const draft: PlanDraft = {
      title: "No cutback",
      startDate: START,
      weeks: miles.map((distance, index) => ({
        weekNumber: index + 1,
        workouts: [workout(0, "easy", `Easy ${index + 1}`, distance)],
      })),
    };
    assert.ok(codes(draft).includes("mileage_cutback"));
  });

  it("rejects a peak label before the base", () => {
    const draft: PlanDraft = {
      title: "Backwards",
      startDate: START,
      weeks: [
        {
          weekNumber: 1,
          focus: "Peak",
          workouts: [workout(0, "easy", "Easy", 8)],
        },
        {
          weekNumber: 2,
          focus: "Base",
          workouts: [workout(0, "easy", "Easy", 8)],
        },
      ],
    };
    assert.ok(codes(draft).includes("phase_order"));
  });
});

describe("missed-work saves", () => {
  it("blocks a plan rewrite when the athlete only reported a miss", () => {
    const result = handlePlanSave({
      mode: "interactive",
      userText: "I missed my long run yesterday",
      reason: "agreed_makeup",
      draft: racePlan(14),
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.message, /optional/i);
    }
  });

  it("allows the same plan after they agree", () => {
    const result = handlePlanSave({
      mode: "interactive",
      userText: "Yes, please update the plan",
      reason: "agreed_makeup",
      draft: racePlan(14),
    });
    assert.equal(
      result.success,
      true,
      result.success ? "" : result.message,
    );
  });

  it("blocks an automatic check-in from adding a big block of miles", () => {
    const result = handlePlanSave({
      mode: "automatic",
      userText: null,
      reason: "recovery_adjustment",
      previousRunningMiles: 40,
      draft: racePlan(14),
    });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /make-up/i);
  });
});

function runningEasyShare(week: PlanWeekDraft): number {
  let miles = 0;
  let easy = 0;
  for (const item of week.workouts) {
    const distance = item.distanceMiles ?? 0;
    if (!RUNNING_TYPES.has(item.type) || !(distance > 0)) continue;
    miles += distance;
    if (EASY_TYPES.has(item.type)) easy += distance;
  }
  return miles === 0 ? 1 : easy / miles;
}

/**
 * Low-volume, high-intensity 5K block. Quality miles include the warm-up
 * and cool-down, so easy share sits near 60% — under the 75% coaching
 * target, and previously rejected.
 * Race day is sent as dayOfWeek 5 (Saturday) with date 2027-01-01 (Friday).
 */
function sub18FiveKPlan(): PlanDraft {
  const quality = (
    weekNumber: number,
    mon: number,
    interval: number,
    wed: number,
    tempo: number,
    long: number,
  ): PlanWeekDraft => ({
    weekNumber,
    workouts: [
      workout(0, "easy", `Easy ${weekNumber}`, mon),
      workout(1, "interval", `Intervals ${weekNumber}`, interval),
      workout(2, "easy", `Easy ${weekNumber} mid`, wed),
      workout(3, "tempo", `Tempo ${weekNumber}`, tempo),
      workout(5, "long", `Long ${weekNumber}`, long),
    ],
  });

  return {
    title: "5K Sub-18 Block",
    goal: "5K under 18:00 by Jan 1 2027, less volume and more intensity",
    startDate: "2026-10-26",
    endDate: "2027-01-01",
    raceDate: "2027-01-01",
    taperDays: 12,
    weeks: [
      quality(1, 3, 4, 3, 4, 6),
      quality(2, 4, 4, 3, 4, 6),
      quality(3, 4, 4, 3, 4, 6),
      quality(4, 4, 4, 3, 4, 7),
      quality(5, 4, 4, 3, 4, 7),
      quality(6, 4, 4, 3, 4, 7),
      quality(7, 4, 4, 4, 4, 8),
      {
        weekNumber: 8,
        workouts: [
          ...quality(8, 3, 4, 3, 4, 6).workouts,
          workout(6, "easy", "Taper shakeout 8", 3),
        ],
      },
      {
        weekNumber: 9,
        workouts: [
          workout(0, "easy", "Taper easy 9", 3),
          workout(2, "easy", "Taper easy 9 mid", 3),
          workout(4, "easy", "Taper easy 9 fri", 3),
        ],
      },
      {
        weekNumber: 10,
        workouts: [
          workout(0, "easy", "Taper easy 10", 2),
          workout(2, "easy", "Taper easy 10 mid", 2),
          {
            ...workout(5, "race", "5K", 3.1),
            date: "2027-01-01",
          },
        ],
      },
    ],
  };
}

describe("low-volume 5K block", () => {
  it("accepts a 10-week sub-18 plan from 2026-10-26 to 2027-01-01 on the first pass", () => {
    const draft = sub18FiveKPlan();
    assert.ok(runningEasyShare(draft.weeks[0]!) < 0.75);
    assert.ok(runningEasyShare(draft.weeks[0]!) >= 0.5);

    const result = preparePlanForSave(draft);
    assert.equal(
      result.ok,
      true,
      result.ok ? "" : result.issues.map((issue) => issue.message).join("\n"),
    );
    if (!result.ok) return;
    assert.equal(result.plan.raceDate, "2027-01-01");
    assert.equal(result.plan.taperDays, 12);
    assert.equal(result.plan.startDate, "2026-10-26");
    const race = result.plan.weeks
      .flatMap((week) => week.workouts)
      .find((item) => item.type === "race");
    assert.equal(race?.date, "2027-01-01");
    assert.equal(race?.dayOfWeek, 4);
  });

  it("allows a modest mileage dip from base into build", () => {
    const draft: PlanDraft = {
      title: "Modest dip",
      startDate: "2026-08-03",
      raceDate: "2026-09-13",
      taperDays: 14,
      weeks: [
        {
          weekNumber: 1,
          workouts: [
            workout(0, "easy", "Easy 1a", 8),
            workout(2, "easy", "Easy 1b", 6),
            workout(5, "long", "Long 1", 6),
          ],
        },
        {
          weekNumber: 2,
          workouts: [
            workout(2, "easy", "Easy 2a", 6),
            workout(4, "easy", "Easy 2b", 6),
            workout(5, "long", "Long 2", 6),
          ],
        },
        {
          weekNumber: 3,
          workouts: [
            workout(0, "easy", "Easy 3a", 5),
            workout(2, "easy", "Easy 3b", 5),
            workout(5, "long", "Long 3", 6),
          ],
        },
        {
          weekNumber: 4,
          workouts: [
            workout(0, "easy", "Easy 4a", 6),
            workout(2, "easy", "Easy 4b", 6),
            workout(5, "long", "Long 4", 6),
            workout(6, "easy", "Taper sun", 3),
          ],
        },
        {
          weekNumber: 5,
          workouts: [
            workout(0, "easy", "Shake 5a", 3),
            workout(2, "easy", "Shake 5b", 3),
            workout(4, "easy", "Shake 5c", 3),
          ],
        },
        {
          weekNumber: 6,
          workouts: [
            workout(0, "easy", "Shake 6a", 3),
            workout(2, "easy", "Shake 6b", 3),
            workout(4, "easy", "Shake 6c", 2),
            workout(6, "race", "Goal race", 3.1),
          ],
        },
      ],
    };
    const result = preparePlanForSave(draft);
    assert.equal(
      result.ok,
      true,
      result.ok ? "" : result.issues.map((issue) => issue.message).join("\n"),
    );
  });

  it("still rejects a build that collapses far under the base", () => {
    const draft: PlanDraft = {
      title: "Collapsed build",
      startDate: "2026-08-03",
      raceDate: "2026-09-13",
      taperDays: 14,
      weeks: [
        {
          weekNumber: 1,
          workouts: [
            workout(0, "easy", "Easy 1a", 8),
            workout(2, "easy", "Easy 1b", 6),
            workout(5, "long", "Long 1", 6),
          ],
        },
        {
          weekNumber: 2,
          workouts: [
            workout(2, "easy", "Easy 2", 3),
            workout(5, "long", "Long 2", 3),
          ],
        },
        {
          weekNumber: 3,
          workouts: [
            workout(0, "easy", "Easy 3", 3),
            workout(5, "long", "Long 3", 3),
          ],
        },
        {
          weekNumber: 4,
          workouts: [
            workout(0, "easy", "Easy 4", 3),
            workout(5, "long", "Long 4", 3),
            workout(6, "easy", "Taper sun", 2),
          ],
        },
        {
          weekNumber: 5,
          workouts: [
            workout(0, "easy", "Shake 5a", 2),
            workout(2, "easy", "Shake 5b", 2),
          ],
        },
        {
          weekNumber: 6,
          workouts: [
            workout(0, "easy", "Shake 6", 2),
            workout(6, "race", "Goal race", 3.1),
          ],
        },
      ],
    };
    assert.ok(codes(draft).includes("phase_load"));
  });
});

describe("plan save instructions", () => {
  it("keeps the 75% easy guidance and tells the coach to send weeks in one call", () => {
    const rules = planRulesForPrompt();
    assert.match(rules, /75/);
    assert.match(rules, /non-empty weeks array/);
    assert.match(rules, /1-2 sentences/);
    const prompt = buildCoachSystemPrompt(null);
    assert.match(prompt, /1-2 sentences/);
    assert.match(prompt, /75/);
  });
});
