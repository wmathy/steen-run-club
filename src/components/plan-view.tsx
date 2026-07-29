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

export function PlanView({ plan }: { plan: Plan | null }) {
  const [selected, setSelected] = useState<SelectedWorkout | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    // Prevent background scroll while modal open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

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
          Tap a day for full workout details. Today is highlighted.
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
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
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
                    <p className="mt-2 text-[10px] font-medium text-accent/80">
                      Tap for full details
                    </p>
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
              {selected.workout.completed && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-muted">
                  Marked complete
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

            <button
              type="button"
              onClick={() => setSelected(null)}
              className="mt-6 flex min-h-12 w-full items-center justify-center rounded-xl bg-accent text-sm font-semibold text-black"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
