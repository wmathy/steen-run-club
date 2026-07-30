"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  dayName,
  formatDuration,
  formatMiles,
  formatShortDate,
  formatWeekRange,
  weekDateRange,
  workoutDate,
  workoutTypeLabel,
  cn,
} from "@/lib/utils";

export type CompletionStatus = "as_planned" | "modified" | null;

type Workout = {
  id: string;
  dayOfWeek: number;
  type: string;
  title: string;
  description: string | null;
  distanceMiles: number | null;
  durationMin: number | null;
  targetPace?: string | null;
  completed: boolean;
  completionStatus?: CompletionStatus;
};

type Week = {
  id: string;
  weekNumber: number;
  focus: string | null;
  notes: string | null;
  workouts: Workout[];
};

type Plan = {
  id: string;
  title: string;
  goal: string | null;
  /** ISO string from server (preferred) or Date */
  startDate: Date | string;
  endDate: Date | string | null;
  notes: string | null;
  weeks: Week[];
};

type SelectedWorkout = {
  workout: Workout;
  weekNumber: number;
  weekFocus: string | null;
  date: Date;
};

function weekMileage(workouts: Workout[]): number {
  return workouts.reduce((sum, wo) => sum + (wo.distanceMiles ?? 0), 0);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function localToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0);
}

function completionLabel(status: CompletionStatus | undefined): string | null {
  if (status === "as_planned") return "As planned";
  if (status === "modified") return "Modified";
  return null;
}

function deviceTimeZone(): string | undefined {
  if (typeof Intl === "undefined") return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function PlanView({ plan: initialPlan }: { plan: Plan | null }) {
  const [plan, setPlan] = useState(initialPlan);
  const [selected, setSelected] = useState<SelectedWorkout | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    setPlan(initialPlan);
  }, [initialPlan]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

  function updateWorkoutLocal(
    workoutId: string,
    patch: { completed: boolean; completionStatus: CompletionStatus },
  ) {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w) => ({
          ...w,
          workouts: w.workouts.map((wo) =>
            wo.id === workoutId ? { ...wo, ...patch } : wo,
          ),
        })),
      };
    });
    setSelected((prev) =>
      prev && prev.workout.id === workoutId
        ? { ...prev, workout: { ...prev.workout, ...patch } }
        : prev,
    );
  }

  async function setCompletion(
    workout: Workout,
    next: CompletionStatus,
  ) {
    // Toggle off if tapping the same option again
    const status: CompletionStatus =
      workout.completionStatus === next ? null : next;

    setSavingId(workout.id);
    setErrorMsg(null);
    setStatusMsg(null);

    // Optimistic UI
    updateWorkoutLocal(workout.id, {
      completed: status !== null,
      completionStatus: status,
    });

    try {
      const res = await fetch(`/api/plan/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          timeZone: deviceTimeZone(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        coachNotified?: boolean;
        workout?: {
          completed: boolean;
          completionStatus: CompletionStatus;
        };
      };
      if (!res.ok) {
        // Revert
        updateWorkoutLocal(workout.id, {
          completed: workout.completed,
          completionStatus: workout.completionStatus ?? null,
        });
        setErrorMsg(data.error || "Could not update workout");
        return;
      }
      if (data.workout) {
        updateWorkoutLocal(workout.id, {
          completed: data.workout.completed,
          completionStatus: data.workout.completionStatus ?? null,
        });
      }
      if (data.coachNotified) {
        setStatusMsg(
          "Coach is reviewing this day — check the Coach tab for a reply.",
        );
      } else if (status === null) {
        setStatusMsg("Cleared completion mark.");
      }
    } catch {
      updateWorkoutLocal(workout.id, {
        completed: workout.completed,
        completionStatus: workout.completionStatus ?? null,
      });
      setErrorMsg("Network error — try again.");
    } finally {
      setSavingId(null);
    }
  }

  if (!plan) {
    return (
      <div className="rounded-2xl border border-dashed border-card-border bg-card/40 px-6 py-14 text-center">
        <div className="mb-3 text-3xl">📅</div>
        <h2 className="mb-2 text-lg font-semibold">No active plan</h2>
        <p className="mx-auto mb-4 max-w-sm text-sm text-muted">
          Chat with your coach to build a periodized plan. When the coach saves
          it, it will show up here week by week.
        </p>
        <Link
          href="/chat"
          className="inline-flex rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black"
        >
          Open coach chat
        </Link>
      </div>
    );
  }

  const today = localToday();
  const planStartLabel = formatShortDate(
    weekDateRange(plan.startDate, 1).start,
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-card-border bg-card/80 p-5">
        <h1 className="text-xl font-bold">{plan.title}</h1>
        {plan.goal && (
          <p className="mt-1 text-sm text-accent">Goal: {plan.goal}</p>
        )}
        <p className="mt-2 text-xs text-muted">Starts {planStartLabel}</p>
        {plan.notes && (
          <p className="mt-3 text-sm text-muted">{plan.notes}</p>
        )}
        <p className="mt-3 text-[11px] text-muted">
          Tap a day for full workout details. Mark complete as planned or
          modified — your coach will review Strava/run data and reply in Coach
          chat.
        </p>
      </div>

      {plan.weeks.map((week) => {
        const { start, end } = weekDateRange(plan.startDate, week.weekNumber);
        const totalMiles = weekMileage(week.workouts);
        const rounded = Math.round(totalMiles * 10) / 10;

        return (
          <section key={week.id} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div>
                <h2 className="text-sm font-semibold">
                  Week {week.weekNumber}
                  {week.focus ? (
                    <span className="ml-2 font-normal text-muted">
                      — {week.focus}
                    </span>
                  ) : null}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {formatWeekRange(start, end)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-accent">
                  {formatMiles(rounded)}
                </p>
                <p className="text-[11px] text-muted">total mileage</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {week.workouts.map((wo) => {
                const date = workoutDate(
                  plan.startDate,
                  week.weekNumber,
                  wo.dayOfWeek,
                );
                const isToday = isSameLocalDay(date, today);
                const mark = completionLabel(wo.completionStatus);
                return (
                  <button
                    key={wo.id}
                    type="button"
                    onClick={() =>
                      setSelected({
                        workout: wo,
                        weekNumber: week.weekNumber,
                        weekFocus: week.focus,
                        date,
                      })
                    }
                    className={cn(
                      "rounded-xl border p-3 text-left transition active:scale-[0.99]",
                      isToday
                        ? "border-accent bg-accent-soft ring-2 ring-accent/50 shadow-[0_0_0_1px_rgba(61,214,140,0.25)]"
                        : "border-card-border bg-card/60 hover:border-accent/40",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">
                        {dayName(wo.dayOfWeek)}{" "}
                        <span className="text-muted/80">
                          {formatShortDate(date)}
                        </span>
                        {isToday && (
                          <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
                            Today
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide",
                          wo.type === "strength"
                            ? "bg-accent-soft text-accent"
                            : "bg-white/5 text-muted",
                        )}
                      >
                        {workoutTypeLabel(wo.type)}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold leading-snug">
                      {wo.title}
                    </h3>
                    <div className="mt-1 text-xs text-muted">
                      {wo.distanceMiles != null &&
                        formatMiles(wo.distanceMiles)}
                      {wo.distanceMiles != null &&
                        wo.durationMin != null &&
                        " · "}
                      {wo.durationMin != null &&
                        formatDuration(wo.durationMin)}
                      {wo.targetPace && (
                        <span className="block text-accent/90">
                          {wo.targetPace}
                        </span>
                      )}
                    </div>
                    {wo.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted/90">
                        {wo.description}
                      </p>
                    )}
                    {mark ? (
                      <p className="mt-2 text-[10px] font-semibold text-accent">
                        ✓ {mark}
                      </p>
                    ) : (
                      <p className="mt-2 text-[10px] font-medium text-accent/80">
                        Tap for details &amp; complete
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Week {selected.weekNumber}
                  {selected.weekFocus ? ` · ${selected.weekFocus}` : ""}
                </p>
                <h2
                  id={titleId}
                  className="mt-1 text-lg font-bold leading-snug"
                >
                  {selected.workout.title}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {dayName(selected.workout.dayOfWeek)},{" "}
                  {formatShortDate(selected.date)}
                  {isSameLocalDay(selected.date, today) && (
                    <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-black">
                      Today
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="min-h-10 shrink-0 rounded-lg px-3 text-sm text-muted hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                {workoutTypeLabel(selected.workout.type)}
              </span>
              {selected.workout.completionStatus === "as_planned" && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-muted">
                  Completed as planned
                </span>
              )}
              {selected.workout.completionStatus === "modified" && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-muted">
                  Modified run
                </span>
              )}
            </div>

            <dl className="space-y-3 text-sm">
              {selected.workout.distanceMiles != null && (
                <div>
                  <dt className="text-xs text-muted">Distance</dt>
                  <dd className="font-medium">
                    {formatMiles(selected.workout.distanceMiles)}
                  </dd>
                </div>
              )}
              {selected.workout.durationMin != null && (
                <div>
                  <dt className="text-xs text-muted">Duration</dt>
                  <dd className="font-medium">
                    {formatDuration(selected.workout.durationMin)}
                  </dd>
                </div>
              )}
              {selected.workout.targetPace && (
                <div>
                  <dt className="text-xs text-muted">Suggested pace</dt>
                  <dd className="font-medium text-accent">
                    {selected.workout.targetPace}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Details</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {selected.workout.description?.trim() ||
                    "No extra notes for this day. Ask your coach if you want more structure."}
                </dd>
              </div>
            </dl>

            {selected.workout.type !== "rest" && (
              <div className="mt-6 space-y-3 rounded-xl border border-card-border bg-black/20 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  How did this day go?
                </p>
                <p className="text-xs text-muted">
                  {selected.workout.type === "strength"
                    ? "Check one option. Your coach will reply in the Coach tab about this lift session."
                    : "Check one option. We'll match your Strava/run log for this date and your coach will reply in the Coach tab."}
                </p>

                <label
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition",
                    selected.workout.completionStatus === "as_planned"
                      ? "border-accent bg-accent-soft"
                      : "border-card-border hover:border-accent/40",
                    savingId === selected.workout.id && "opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--accent,#3dd68c)]"
                    checked={
                      selected.workout.completionStatus === "as_planned"
                    }
                    disabled={savingId === selected.workout.id}
                    onChange={() =>
                      setCompletion(selected.workout, "as_planned")
                    }
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {selected.workout.type === "strength"
                        ? "Completed workout as planned"
                        : "Completed run as planned"}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      I did this workout as prescribed
                    </span>
                  </span>
                </label>

                <label
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition",
                    selected.workout.completionStatus === "modified"
                      ? "border-accent bg-accent-soft"
                      : "border-card-border hover:border-accent/40",
                    savingId === selected.workout.id && "opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--accent,#3dd68c)]"
                    checked={
                      selected.workout.completionStatus === "modified"
                    }
                    disabled={savingId === selected.workout.id}
                    onChange={() =>
                      setCompletion(selected.workout, "modified")
                    }
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {selected.workout.type === "strength"
                        ? "Modified today's workout"
                        : "Modified today's run"}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {selected.workout.type === "strength"
                        ? "I changed exercises, sets, reps, or load"
                        : "I changed distance, pace, type, or skipped structure"}
                    </span>
                  </span>
                </label>

                {statusMsg && (
                  <p className="text-xs text-accent">{statusMsg}</p>
                )}
                {errorMsg && (
                  <p className="text-xs text-danger">{errorMsg}</p>
                )}
                {savingId === selected.workout.id && (
                  <p className="text-xs text-muted">Saving…</p>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/chat"
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-card-border text-sm font-semibold text-accent"
              >
                Open Coach
              </Link>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-black"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
