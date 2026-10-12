/**
 * Training-plan rules modeled on the coaches named in this repo:
 * Steve Magness and Jeff Cunningham (see coach-prompt history).
 *
 * Magness: most running easy, easy days protected, patient progressive
 * overload, psychology without shame, periodization that still feels human.
 * Cunningham: easy running, one purposeful quality session, recovery as a
 * pillar, a plan that fits real life and lasts past week six.
 *
 * Race plans progress base → build → peak, then a taper of 10–14 days.
 * That taper length is a hard rule, checked here — not only in the prompt.
 */

import { MAX_PLAN_WEEKS } from "@/lib/validation";
import {
  addIsoDays,
  dateForPlanSlot,
  daysBetween,
  mondayOf,
  planDayName,
} from "@/lib/plan-dates";
import {
  EASY_TYPES,
  QUALITY_TYPES,
  RUNNING_TYPES,
  STRESS_TYPES,
  type PlanDraft,
  type PlanIssue,
  type PlanWeekDraft,
  type PlanWorkoutDraft,
} from "@/lib/plan-model";

export const MIN_TAPER_DAYS = 10;
export const MAX_TAPER_DAYS = 14;
/** ~10% is the coaching guide; more than this is rejected. */
export const MAX_WEEKLY_MILEAGE_INCREASE = 0.2;
export const MIN_EASY_MILE_SHARE = 0.75;
export const MAX_QUALITY_SESSIONS_PER_WEEK = 2;
export const MAX_CONSECUTIVE_MILEAGE_INCREASES = 3;
/** Taper miles over an equal-length window must stay at or under this share. */
export const MAX_TAPER_VOLUME_SHARE = 0.85;
/** Taper long run vs the longest pre-taper long run. */
export const MAX_TAPER_LONG_RUN_SHARE = 0.75;
export const MIN_PRE_TAPER_DAYS_FOR_THREE_PHASES = 21;

export const PHASES = ["base", "build", "peak", "taper"] as const;
export type Phase = (typeof PHASES)[number];

const PHASE_INDEX: Record<Phase, number> = {
  base: 0,
  build: 1,
  peak: 2,
  taper: 3,
};

export type PhaseSpan = {
  phase: Phase;
  /** Inclusive YYYY-MM-DD */
  start: string;
  /** Exclusive YYYY-MM-DD */
  end: string;
};

export type NormalizedPlan = PlanDraft & {
  raceDate: string | null;
  taperDays: number | null;
  endDate: string | null;
};

type DatedWorkout = PlanWorkoutDraft & {
  weekNumber: number;
  isoDate: string;
};

function roundMiles(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function milesOf(workout: { distanceMiles?: number | null }): number {
  const n = workout.distanceMiles;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

export function totalRunningMiles(
  weeks: Array<{ workouts: Array<{ type: string; distanceMiles?: number | null }> }>,
): number {
  let total = 0;
  for (const week of weeks) {
    for (const workout of week.workouts) {
      if (RUNNING_TYPES.has(workout.type)) total += milesOf(workout);
    }
  }
  return total;
}

export function taperStartDate(raceDate: string, taperDays: number): string {
  return addIsoDays(raceDate, -taperDays);
}

/**
 * Phase windows for a race plan.
 * The grid starts on the Monday of week 1, matching the Plan tab.
 * Taper is the `taperDays` calendar days before race day (race day excluded).
 */
export function phaseSpans(
  planStart: string,
  raceDate: string,
  taperDays: number,
): PhaseSpan[] {
  const gridStart = mondayOf(planStart);
  const taperStart = taperStartDate(raceDate, taperDays);
  const spans: PhaseSpan[] = [];
  const preDays = daysBetween(gridStart, taperStart);

  if (preDays > 0) {
    if (preDays >= MIN_PRE_TAPER_DAYS_FOR_THREE_PHASES) {
      const third = Math.floor(preDays / 3);
      const baseEnd = addIsoDays(gridStart, Math.max(third, 1));
      const buildEnd = addIsoDays(gridStart, Math.max(third * 2, third + 1));
      spans.push({ phase: "base", start: gridStart, end: baseEnd });
      spans.push({ phase: "build", start: baseEnd, end: buildEnd });
      spans.push({
        phase: "peak",
        start: buildEnd,
        end: taperStart,
      });
    } else if (preDays >= 14) {
      const half = Math.floor(preDays / 2);
      const mid = addIsoDays(gridStart, Math.max(half, 1));
      spans.push({ phase: "build", start: gridStart, end: mid });
      spans.push({ phase: "peak", start: mid, end: taperStart });
    } else {
      spans.push({ phase: "build", start: gridStart, end: taperStart });
    }
  }

  spans.push({ phase: "taper", start: taperStart, end: raceDate });
  return spans.filter((span) => span.start < span.end);
}

export function phaseOnDate(
  iso: string,
  raceDate: string,
  spans: PhaseSpan[],
): Phase | "race" | null {
  if (iso === raceDate) return "race";
  for (const span of spans) {
    if (iso >= span.start && iso < span.end) return span.phase;
  }
  return null;
}

function phaseWords(text: string | null | undefined): Set<Phase> {
  const found = new Set<Phase>();
  if (!text) return found;
  const lower = text.toLowerCase();
  for (const phase of PHASES) {
    const pattern = new RegExp(`\\b${phase}\\b`, "i");
    if (pattern.test(lower)) found.add(phase);
  }
  return found;
}

function titleCasePhase(phase: Phase): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function dateWorkouts(plan: PlanDraft): DatedWorkout[] {
  const dated: DatedWorkout[] = [];
  for (const week of plan.weeks) {
    for (const workout of week.workouts) {
      dated.push({
        ...workout,
        weekNumber: week.weekNumber,
        isoDate: dateForPlanSlot(
          plan.startDate,
          week.weekNumber,
          workout.dayOfWeek,
        ),
      });
    }
  }
  dated.sort((a, b) =>
    a.isoDate === b.isoDate
      ? a.dayOfWeek - b.dayOfWeek
      : a.isoDate < b.isoDate
        ? -1
        : 1,
  );
  return dated;
}

function milesBetween(
  workouts: DatedWorkout[],
  startInclusive: string,
  endExclusive: string,
): number {
  let total = 0;
  for (const workout of workouts) {
    if (workout.isoDate < startInclusive || workout.isoDate >= endExclusive) {
      continue;
    }
    if (RUNNING_TYPES.has(workout.type)) total += milesOf(workout);
  }
  return total;
}

export function describePlanStructure(
  planStart: string,
  raceDate: string,
  taperDays: number,
): string {
  const spans = phaseSpans(planStart, raceDate, taperDays);
  const parts = spans.map((span) => {
    const lastDay = addIsoDays(span.end, -1);
    return `${titleCasePhase(span.phase)} ${span.start} through ${lastDay}`;
  });
  parts.push(`Race day ${raceDate}`);
  return parts.join("; ");
}

export function planRulesForPrompt(): string {
  return `
## How plans are built (this is checked in code when you save)

Coaching methods to live, not lecture. Steve Magness: most running stays easy so the hard days work; progress when the athlete is absorbing training; confidence and patience beat grind theater; never shame a missed day. Jeff Cunningham: easy running, one purposeful quality session, recovery, and a repeatable week that fits real life. Healthy and still racing beats a heroic plan that breaks them.

### Race plans progress toward race day
Order is always base, then build, then peak, then taper, then race day. Early weeks are mostly easy aerobic volume. The build adds a little volume and one clear quality session. The peak is the highest sustainable load (or within about 10% of it), still with easy days truly easy. Do not put peak work before the base.

### Taper (hard rule)
When there is a goal race, set raceDate and taperDays. taperDays must be an integer from ${MIN_TAPER_DAYS} to ${MAX_TAPER_DAYS}. That is the number of days before race day, not counting race day itself. The plan must start on or before the taper starts, and race day needs a workout with type race. Taper running is easy and shorter — no tempo or interval in the taper window. A tune-up race belongs before the taper, not inside it. If save_or_update_plan returns taper errors, fix the plan and save again. Do not tell the athlete a race plan is saved until the tool succeeds.

### Week shape
- About 75% or more of running miles are easy, recovery, or a steady long run. Quality (tempo or interval) is at most ${MAX_QUALITY_SESSIONS_PER_WEEK} sessions in a week.
- Do not stack stress: tempo, interval, long run, and race day are not on back-to-back days.
- One long run a week. Grow it patiently (about 10%, and never more than 2 miles or 20% above the previous long run).
- Weekly mileage grows patiently. The guide is about 10%. A jump over 20% is rejected. After three weeks that each add miles, the next week is a cutback — recovery is part of the plan.
- General-fitness plans with no race skip the taper. The easy/hard balance, long-run growth, and mileage ramp still apply.

### Missed work
If they missed miles or a workout, you may suggest an optional make-up (short, easy, only if the week has room). Never demand it. Never guilt them. Do not change the stored plan for missed work unless they clearly agree ("yes", "go ahead", "please update the plan"). Use reason "agreed_makeup" only after that yes.

### Schedule changes
If they ask to move, shift, swap, switch, or reschedule a workout or day, call edit_plan_schedule before you say it's done. That tool writes the stored plan. Do not only describe the new week.
`.trim();
}

function taperLengthIssue(
  taperDays: number | null | undefined,
  raceDate: string,
): PlanIssue | null {
  if (
    taperDays == null ||
    !Number.isInteger(taperDays) ||
    taperDays < MIN_TAPER_DAYS ||
    taperDays > MAX_TAPER_DAYS
  ) {
    const start10 = addIsoDays(raceDate, -MIN_TAPER_DAYS);
    const start14 = addIsoDays(raceDate, -MAX_TAPER_DAYS);
    return {
      code: "taper_length",
      message: `Taper length must be ${MIN_TAPER_DAYS}–${MAX_TAPER_DAYS} days before race day ${raceDate}. Received ${taperDays ?? "no taperDays"}. taperDays ${MIN_TAPER_DAYS} starts ${start10}; taperDays ${MAX_TAPER_DAYS} starts ${start14}.`,
    };
  }
  return null;
}

export function preparePlanForSave(
  draft: PlanDraft,
): { ok: true; plan: NormalizedPlan } | { ok: false; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const weeks = draft.weeks.map((week) => ({
    ...week,
    focus: week.focus ?? null,
    notes: week.notes ?? null,
    workouts: week.workouts.map((workout) => ({ ...workout })),
  }));

  const seenWeeks = new Set<number>();
  for (const week of weeks) {
    if (seenWeeks.has(week.weekNumber)) {
      issues.push({
        code: "duplicate_week",
        message: `Week ${week.weekNumber} is listed twice. Use each week number once.`,
      });
    }
    seenWeeks.add(week.weekNumber);
    if (week.weekNumber < 1 || week.weekNumber > MAX_PLAN_WEEKS) {
      issues.push({
        code: "week_range",
        message: `Week ${week.weekNumber} is outside 1–${MAX_PLAN_WEEKS}.`,
      });
    }
  }

  const plan: PlanDraft = { ...draft, weeks };
  const dated = dateWorkouts(plan);
  const inferredRace =
    draft.raceDate ??
    dated
      .filter((workout) => workout.type === "race")
      .map((workout) => workout.isoDate)
      .sort()
      .at(-1) ??
    null;

  if (!inferredRace) {
    issues.push(...structureIssues(plan, dated, null, null));
    if (issues.length) return { ok: false, issues };
    return {
      ok: true,
      plan: {
        ...plan,
        raceDate: null,
        taperDays: null,
        endDate: draft.endDate ?? null,
        weeks: annotateWeeks(plan, null, null),
      },
    };
  }

  const raceDate = inferredRace;
  const lengthIssue = taperLengthIssue(draft.taperDays, raceDate);
  if (lengthIssue) issues.push(lengthIssue);

  const taperDays =
    lengthIssue || draft.taperDays == null ? null : draft.taperDays;

  if (taperDays != null) {
    issues.push(...raceWindowIssues(plan, dated, raceDate, taperDays));
    issues.push(...structureIssues(plan, dated, raceDate, taperDays));
  } else {
    issues.push(...structureIssues(plan, dated, null, null));
  }

  if (issues.length) return { ok: false, issues };

  const spans = phaseSpans(plan.startDate, raceDate, taperDays!);
  const annotated = annotateWeeks(plan, spans, raceDate);
  const endDate =
    draft.endDate && draft.endDate >= raceDate ? draft.endDate : raceDate;

  return {
    ok: true,
    plan: {
      ...plan,
      weeks: annotated,
      raceDate,
      taperDays,
      endDate,
    },
  };
}

function raceWindowIssues(
  plan: PlanDraft,
  dated: DatedWorkout[],
  raceDate: string,
  taperDays: number,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const gridStart = mondayOf(plan.startDate);
  const taperStart = taperStartDate(raceDate, taperDays);

  if (raceDate < plan.startDate) {
    issues.push({
      code: "taper_coverage",
      message: `Race day ${raceDate} is before the plan starts (${plan.startDate}).`,
    });
  }

  if (taperStart < gridStart) {
    issues.push({
      code: "taper_coverage",
      message: `A ${taperDays}-day taper before ${raceDate} starts on ${taperStart}, which is before this plan's first week (${gridStart}). Start the plan on or before the taper, or pick a later race.`,
    });
  }

  const raceSlot = dated.filter(
    (workout) => workout.type === "race" && workout.isoDate === raceDate,
  );
  if (raceSlot.length === 0) {
    issues.push({
      code: "taper_race_missing",
      message: `Race day ${raceDate} needs a workout with type "race" on that calendar day.`,
    });
  }

  for (const workout of dated) {
    const inTaper = workout.isoDate >= taperStart && workout.isoDate < raceDate;
    if (!inTaper) continue;
    if (QUALITY_TYPES.has(workout.type)) {
      issues.push({
        code: "taper_hard_day",
        message: `${titleCasePhase("taper")} day ${workout.isoDate} (${planDayName(workout.dayOfWeek)}) is a ${workout.type} ("${workout.title}"). Keep the ${taperDays} days before race day easy.`,
      });
    }
    if (workout.type === "race") {
      issues.push({
        code: "race_in_taper",
        message: `A race on ${workout.isoDate} sits inside the taper before ${raceDate}. Put tune-up races before ${taperStart}.`,
      });
    }
  }

  const priorStart = addIsoDays(taperStart, -taperDays);
  const taperMiles = milesBetween(dated, taperStart, raceDate);
  const priorMiles = milesBetween(dated, priorStart, taperStart);
  if (priorMiles >= 8 && taperMiles > priorMiles * MAX_TAPER_VOLUME_SHARE + 0.05) {
    issues.push({
      code: "taper_volume",
      message: `Taper volume is too high. Miles from ${taperStart} through the day before ${raceDate} are ${roundMiles(taperMiles)}, and the previous ${taperDays} days are ${roundMiles(priorMiles)}. Bring the taper down to about ${Math.round(MAX_TAPER_VOLUME_SHARE * 100)}% or less of that prior block.`,
    });
  }

  const priorLong = dated
    .filter(
      (workout) => workout.type === "long" && workout.isoDate < taperStart,
    )
    .reduce((max, workout) => Math.max(max, milesOf(workout)), 0);
  if (priorLong > 0) {
    const cap = priorLong * MAX_TAPER_LONG_RUN_SHARE;
    for (const workout of dated) {
      if (workout.type !== "long") continue;
      if (workout.isoDate < taperStart || workout.isoDate >= raceDate) continue;
      if (milesOf(workout) > cap + 0.05) {
        issues.push({
          code: "taper_long_run",
          message: `Long run "${workout.title}" on ${workout.isoDate} is ${roundMiles(milesOf(workout))} miles. During the taper keep the long run at or under ${roundMiles(cap)} miles (about ${Math.round(MAX_TAPER_LONG_RUN_SHARE * 100)}% of the longest pre-taper long run, ${roundMiles(priorLong)}).`,
        });
      }
    }
  }

  return issues;
}

function structureIssues(
  plan: PlanDraft,
  dated: DatedWorkout[],
  raceDate: string | null,
  taperDays: number | null,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const spans =
    raceDate && taperDays != null
      ? phaseSpans(plan.startDate, raceDate, taperDays)
      : null;

  if (spans && raceDate) {
    const preDays = daysBetween(mondayOf(plan.startDate), taperStartDate(raceDate, taperDays!));
    const present = new Set<Phase>();
    for (const workout of dated) {
      const phase = phaseOnDate(workout.isoDate, raceDate, spans);
      if (phase && phase !== "race") present.add(phase);
    }
    const required: Phase[] =
      preDays >= MIN_PRE_TAPER_DAYS_FOR_THREE_PHASES
        ? ["base", "build", "peak"]
        : preDays >= 14
          ? ["build", "peak"]
          : [];
    for (const phase of required) {
      if (!present.has(phase)) {
        const span = spans.find((item) => item.phase === phase);
        issues.push({
          code: "phase_missing",
          message: `This race plan needs at least one workout in the ${phase} phase${span ? ` (${span.start} through ${addIsoDays(span.end, -1)})` : ""}. Progress base → build → peak before the taper.`,
        });
      }
    }

    const phaseOrder: Array<Phase | "race"> = [];
    for (const workout of dated) {
      const phase = phaseOnDate(workout.isoDate, raceDate, spans);
      if (!phase) continue;
      if (phaseOrder[phaseOrder.length - 1] !== phase) phaseOrder.push(phase);
    }
    let last = -1;
    for (const phase of phaseOrder) {
      const index = phase === "race" ? 4 : PHASE_INDEX[phase];
      if (index < last) {
        issues.push({
          code: "phase_order",
          message: `Phases must move forward toward race day (base → build → peak → taper). Found ${phase} after a later phase.`,
        });
        break;
      }
      last = index;
    }

    issues.push(...phaseLoadIssues(dated, raceDate, spans));
    issues.push(...focusIssues(plan, raceDate, spans));
  } else {
    issues.push(...focusOrderWithoutRace(plan));
  }

  issues.push(...loadIssues(dated, raceDate, taperDays));
  return issues;
}

function phaseLoadIssues(
  dated: DatedWorkout[],
  raceDate: string,
  spans: PhaseSpan[],
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const weekly = new Map<string, number>();
  for (const workout of dated) {
    const phase = phaseOnDate(workout.isoDate, raceDate, spans);
    if (phase !== "base" && phase !== "build" && phase !== "peak") continue;
    if (!RUNNING_TYPES.has(workout.type)) continue;
    const key = `${phase}:${workout.weekNumber}`;
    weekly.set(key, (weekly.get(key) ?? 0) + milesOf(workout));
  }

  function maxFor(phase: Phase): number {
    let max = 0;
    for (const [key, miles] of weekly) {
      if (key.startsWith(`${phase}:`)) max = Math.max(max, miles);
    }
    return max;
  }

  const baseMax = maxFor("base");
  const buildMax = maxFor("build");
  const peakMax = maxFor("peak");
  if (baseMax > 0 && buildMax > 0 && buildMax + 0.05 < baseMax) {
    issues.push({
      code: "phase_load",
      message: `Build weeks top out at ${roundMiles(buildMax)} miles, under the base peak of ${roundMiles(baseMax)}. Let the build be at least as big as the base before you sharpen.`,
    });
  }
  if (buildMax > 0 && peakMax > 0 && peakMax + 0.05 < buildMax * 0.9) {
    issues.push({
      code: "phase_load",
      message: `Peak weeks top out at ${roundMiles(peakMax)} miles, well under the build (${roundMiles(buildMax)}). The peak should hold near the top of the build before the taper.`,
    });
  }
  return issues;
}

function focusIssues(
  plan: PlanDraft,
  raceDate: string,
  spans: PhaseSpan[],
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  for (const week of plan.weeks) {
    const phases = new Set<Phase>();
    for (const workout of week.workouts) {
      const iso = dateForPlanSlot(plan.startDate, week.weekNumber, workout.dayOfWeek);
      const phase = phaseOnDate(iso, raceDate, spans);
      if (phase && phase !== "race") phases.add(phase);
    }
    if (phases.size === 0) continue;
    const named = phaseWords(week.focus);
    for (const phase of named) {
      if (!phases.has(phase)) {
        issues.push({
          code: "phase_focus",
          message: `Week ${week.weekNumber} is labeled "${week.focus}" but its workouts fall in ${[...phases].join(" and ")}, not ${phase}.`,
        });
      }
    }
  }
  return issues;
}

function annotateWeeks(
  plan: PlanDraft,
  spans: PhaseSpan[] | null,
  raceDate: string | null,
): PlanWeekDraft[] {
  if (!spans || !raceDate) return plan.weeks;
  return plan.weeks.map((week) => {
    const counts = new Map<Phase, number>();
    for (const workout of week.workouts) {
      const iso = dateForPlanSlot(
        plan.startDate,
        week.weekNumber,
        workout.dayOfWeek,
      );
      const phase = phaseOnDate(iso, raceDate, spans);
      if (!phase || phase === "race") continue;
      counts.set(phase, (counts.get(phase) ?? 0) + 1);
    }
    let dominant: Phase | null = null;
    let best = -1;
    for (const phase of PHASES) {
      const count = counts.get(phase) ?? 0;
      if (count >= best && count > 0) {
        best = count;
        dominant = phase;
      }
    }
    if (!dominant) return week;
    const named = phaseWords(week.focus);
    if (named.size > 0) return week;
    const label = titleCasePhase(dominant);
    const focus = week.focus?.trim()
      ? `${label} — ${week.focus.trim()}`
      : label;
    return { ...week, focus };
  });
}

function focusOrderWithoutRace(plan: PlanDraft): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const ordered = [...plan.weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  let last = -1;
  for (const week of ordered) {
    const named = [...phaseWords(week.focus)];
    if (named.length === 0) continue;
    const earliest = Math.min(...named.map((phase) => PHASE_INDEX[phase]));
    const latest = Math.max(...named.map((phase) => PHASE_INDEX[phase]));
    if (earliest < last) {
      issues.push({
        code: "phase_order",
        message: `Week ${week.weekNumber} is labeled "${week.focus}" after a later phase. Keep base → build → peak in that order.`,
      });
      break;
    }
    last = latest;
  }
  return issues;
}

function loadIssues(
  dated: DatedWorkout[],
  raceDate: string | null,
  taperDays: number | null,
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const taperStart =
    raceDate && taperDays != null ? taperStartDate(raceDate, taperDays) : null;

  const byWeek = new Map<number, DatedWorkout[]>();
  for (const workout of dated) {
    const list = byWeek.get(workout.weekNumber) ?? [];
    list.push(workout);
    byWeek.set(workout.weekNumber, list);
  }

  const weekNumbers = [...byWeek.keys()].sort((a, b) => a - b);
  let increases = 0;
  let previousMiles: number | null = null;
  let previousLong: number | null = null;

  for (const weekNumber of weekNumbers) {
    const workouts = byWeek.get(weekNumber) ?? [];
    const training = workouts.filter((workout) => {
      if (!taperStart) return true;
      return workout.isoDate < taperStart;
    });

    let miles = 0;
    let easyMiles = 0;
    let longMiles = 0;
    let longCount = 0;
    let quality = 0;
    for (const workout of training) {
      if (QUALITY_TYPES.has(workout.type)) quality += 1;
      if (workout.type === "long") {
        longCount += 1;
        longMiles = Math.max(longMiles, milesOf(workout));
      }
      if (!RUNNING_TYPES.has(workout.type)) continue;
      const dist = milesOf(workout);
      miles += dist;
      if (EASY_TYPES.has(workout.type)) easyMiles += dist;
    }

    if (quality > MAX_QUALITY_SESSIONS_PER_WEEK) {
      issues.push({
        code: "quality_count",
        message: `Week ${weekNumber} has ${quality} tempo/interval sessions. Keep it to ${MAX_QUALITY_SESSIONS_PER_WEEK} so easy days stay easy.`,
      });
    }
    if (longCount > 1) {
      issues.push({
        code: "long_run_count",
        message: `Week ${weekNumber} has ${longCount} long runs. One long run a week is enough.`,
      });
    }
    if (miles >= 8 && easyMiles / miles + 1e-9 < MIN_EASY_MILE_SHARE) {
      issues.push({
        code: "easy_share",
        message: `Week ${weekNumber} is only ${Math.round((easyMiles / miles) * 100)}% easy miles (${roundMiles(easyMiles)} of ${roundMiles(miles)}). Keep at least ${Math.round(MIN_EASY_MILE_SHARE * 100)}% easy, recovery, or long-run miles.`,
      });
    }
    if (previousMiles != null && previousMiles >= 5 && miles > previousMiles * (1 + MAX_WEEKLY_MILEAGE_INCREASE) + 0.05) {
      issues.push({
        code: "mileage_ramp",
        message: `Week ${weekNumber} jumps to ${roundMiles(miles)} miles from ${roundMiles(previousMiles)}. Hold the increase to about 10%, and not more than 20%.`,
      });
    }
    if (previousMiles != null) {
      if (miles > previousMiles + 0.05) {
        increases += 1;
        if (increases > MAX_CONSECUTIVE_MILEAGE_INCREASES) {
          issues.push({
            code: "mileage_cutback",
            message: `Mileage climbs more than ${MAX_CONSECUTIVE_MILEAGE_INCREASES} weeks in a row into week ${weekNumber}. Insert a cutback week so recovery stays part of the plan.`,
          });
        }
      } else {
        increases = 0;
      }
    }
    if (longMiles > 0) {
      if (
        previousLong != null &&
        previousLong > 0 &&
        longMiles > previousLong + Math.max(2, previousLong * 0.2) + 0.05
      ) {
        issues.push({
          code: "long_run_jump",
          message: `Week ${weekNumber} long run is ${roundMiles(longMiles)} miles after ${roundMiles(previousLong)}. Grow the long run by about 10%, and not more than 2 miles or 20%.`,
        });
      }
      previousLong = longMiles;
    }
    if (training.some((workout) => RUNNING_TYPES.has(workout.type) && milesOf(workout) > 0)) {
      previousMiles = miles;
    }
  }

  const stress = dated
    .filter((workout) => STRESS_TYPES.has(workout.type))
    .sort((a, b) => (a.isoDate < b.isoDate ? -1 : a.isoDate > b.isoDate ? 1 : 0));
  for (let i = 1; i < stress.length; i += 1) {
    const prev = stress[i - 1];
    const curr = stress[i];
    const gap = daysBetween(prev.isoDate, curr.isoDate);
    if (gap <= 1) {
      issues.push({
        code: "stacked_stress",
        message: `${prev.type} "${prev.title}" on ${prev.isoDate} and ${curr.type} "${curr.title}" on ${curr.isoDate} are back to back. Put an easy or rest day between tempo, interval, long run, and race day.`,
      });
    }
  }

  return issues;
}
