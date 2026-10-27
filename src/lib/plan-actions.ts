/**
 * The coach tool path for saving and editing plans.
 * Chat and post-run tools call these so the rules live in one place.
 */

import { assessPlanWrite, type PlanWriteMode, type PlanWriteReason } from "@/lib/plan-policy";
import {
  applyScheduleOperations,
  type ScheduleOperation,
} from "@/lib/plan-edit";
import type { PlanDraft, PlanIssue, StoredPlan } from "@/lib/plan-model";
import {
  describePlanStructure,
  preparePlanForSave,
  totalRunningMiles,
  type NormalizedPlan,
} from "@/lib/plan-rules";

export type PlanRepository = {
  loadActive(userId: string): Promise<StoredPlan | null>;
  saveSchedule(userId: string, plan: StoredPlan): Promise<StoredPlan>;
};

export type PlanActionResult =
  | {
      success: true;
      message: string;
      changes?: string[];
      plan?: NormalizedPlan | StoredPlan;
      issues?: undefined;
    }
  | {
      success: false;
      message: string;
      issues?: PlanIssue[];
    };

function slotsOf(plan: StoredPlan): Map<string, string> {
  const slots = new Map<string, string>();
  for (const week of plan.weeks) {
    for (const workout of week.workouts) {
      slots.set(workout.id, `${week.weekNumber}:${workout.dayOfWeek}`);
    }
  }
  return slots;
}

function driftMessage(expected: StoredPlan, actual: StoredPlan): string | null {
  const wanted = slotsOf(expected);
  const got = slotsOf(actual);
  if (wanted.size !== got.size) {
    return "the saved plan does not have the same workouts.";
  }
  for (const [id, slot] of wanted) {
    if (got.get(id) !== slot) {
      return "a workout did not land on the requested day.";
    }
  }
  if ((actual.raceDate ?? null) !== (expected.raceDate ?? null)) {
    return "race day did not save.";
  }
  if ((actual.taperDays ?? null) !== (expected.taperDays ?? null)) {
    return "taper length did not save.";
  }
  return null;
}

export async function commitScheduleEdit(
  repo: PlanRepository,
  userId: string,
  operations: ScheduleOperation[],
): Promise<PlanActionResult> {
  const current = await repo.loadActive(userId);
  if (!current) {
    return {
      success: false,
      message:
        "There's no active plan to edit yet. Build one with save_or_update_plan first.",
    };
  }

  const applied = applyScheduleOperations(current, operations);
  if (!applied.ok) return { success: false, message: applied.message };

  const saved = await repo.saveSchedule(userId, applied.plan);
  const reloaded = await repo.loadActive(userId);
  if (!reloaded) {
    return {
      success: false,
      message: "The schedule change did not persist. Please try it again.",
    };
  }
  const drift = driftMessage(applied.plan, reloaded);
  if (drift) {
    return {
      success: false,
      message: `The schedule change did not persist (${drift})`,
    };
  }

  // Prefer the reloaded plan so callers see what is actually stored.
  // `saved` must match too — a repository that returns a stale copy fails here.
  const saveDrift = driftMessage(applied.plan, saved);
  if (saveDrift) {
    return {
      success: false,
      message: `The schedule change did not persist (${saveDrift})`,
    };
  }

  return {
    success: true,
    message: applied.changes.join(" "),
    changes: applied.changes,
    plan: reloaded,
  };
}

export async function handlePlanScheduleEdit(input: {
  repo: PlanRepository;
  userId: string;
  mode: PlanWriteMode;
  userText: string | null;
  operations: ScheduleOperation[];
  reason?: PlanWriteReason;
}): Promise<PlanActionResult> {
  const decision = assessPlanWrite({
    mode: input.mode,
    userText: input.userText,
    reason: input.reason ?? "schedule_edit",
  });
  if (!decision.ok) return { success: false, message: decision.message };
  return commitScheduleEdit(input.repo, input.userId, input.operations);
}

export function handlePlanSave(input: {
  mode: PlanWriteMode;
  userText: string | null;
  reason: PlanWriteReason;
  draft: PlanDraft;
  /** Miles on the plan being replaced. Automatic check-ins cannot dump make-up volume back in. */
  previousRunningMiles?: number | null;
}):
  | {
      success: true;
      message: string;
      plan: NormalizedPlan;
      warnings: PlanIssue[];
    }
  | { success: false; message: string; issues?: PlanIssue[] } {
  const decision = assessPlanWrite({
    mode: input.mode,
    userText: input.userText,
    reason: input.reason,
  });
  if (!decision.ok) return { success: false, message: decision.message };

  const prepared = preparePlanForSave(input.draft);
  if (!prepared.ok) {
    return {
      success: false,
      message: prepared.issues.map((issue) => issue.message).join("\n"),
      issues: prepared.issues,
    };
  }

  if (input.mode === "automatic" && input.reason !== "new_plan") {
    const previous = input.previousRunningMiles ?? 0;
    const next = totalRunningMiles(prepared.plan.weeks);
    if (previous > 0 && next > previous * 1.1 + 0.5) {
      return {
        success: false,
        message: `This automatic update would raise the plan from ${Math.round(previous)} to ${Math.round(next)} miles. Do not add make-up miles unless the athlete has agreed. Suggest the optional change in your message instead. Small recovery edits that hold or lower volume are fine.`,
      };
    }
  }

  const structure =
    prepared.plan.raceDate && prepared.plan.taperDays
      ? describePlanStructure(
          prepared.plan.startDate,
          prepared.plan.raceDate,
          prepared.plan.taperDays,
        )
      : null;
  const warningText =
    prepared.warnings.length > 0
      ? ` Optional coaching notes (the plan is already saved; do not call save_or_update_plan again for these): ${prepared.warnings.map((issue) => issue.message).join(" ")}`
      : "";

  return {
    success: true,
    message: structure
      ? `Plan is valid. ${structure}.${warningText}`
      : `Plan is valid.${warningText}`,
    plan: prepared.plan,
    warnings: prepared.warnings,
  };
}
