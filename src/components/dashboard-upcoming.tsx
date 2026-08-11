"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  dayName,
  formatDuration,
  formatMiles,
  formatShortDate,
  workoutTypeLabel,
  cn,
} from "@/lib/utils";

export type DashboardWorkout = {
  id: string;
  dayOfWeek: number;
  type: string;
  title: string;
  description: string | null;
  distanceMiles: number | null;
  durationMin: number | null;
  targetPace: string | null;
  completed: boolean;
  completionStatus: string | null;
  /** ISO date string YYYY-MM-DD for display */
  dateKey: string;
  isToday: boolean;
  isPast: boolean;
};

export type DashboardWeek = {
  weekNumber: number;
  focus: string | null;
  rangeLabel: string;
  workouts: DashboardWorkout[];
};

function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function DashboardUpcoming({ week }: { week: DashboardWeek | null }) {
  const [selected, setSelected] = useState<DashboardWorkout | null>(null);
  const titleId = useId();

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

  if (!week) {
    return (
      <section className="rounded-2xl border border-card-border bg-card/60 p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">This week</h2>
          <Link href="/plan" className="text-xs text-accent hover:underline">
            Full plan
          </Link>
        </div>
        <p className="text-sm text-muted">
          No plan workouts for this week.{" "}
          <Link href="/chat" className="text-accent hover:underline">
            Ask the coach
          </Link>{" "}
          to build your week.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-card-border bg-card/60 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              This week
              <span className="ml-1.5 font-normal text-muted">
                · Week {week.weekNumber}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-muted">{week.rangeLabel}</p>
            {week.focus && (
              <p className="mt-1 text-xs text-accent">{week.focus}</p>
            )}
          </div>
          <Link
            href="/plan"
            className="shrink-0 text-xs font-medium text-accent hover:underline"
          >
            Full plan
          </Link>
        </div>

        <ul className="space-y-2">
          {week.workouts.map((wo) => (
            <li key={wo.id}>
              <button
                type="button"
                onClick={() => setSelected(wo)}
                className={cn(
                  "flex w-full flex-col rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                  wo.isToday
                    ? "border-accent bg-accent-soft ring-1 ring-accent/40"
                    : wo.isPast
                      ? "border-card-border/60 bg-black/15 opacity-90"
                      : "border-card-border/80 bg-black/20 hover:border-accent/40",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted">
                    {dayName(wo.dayOfWeek)}{" "}
                    <span className="text-muted/80">
                      {formatShortDate(parseLocalDateKey(wo.dateKey))}
                    </span>
                    {wo.isToday && (
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
                <div className="mt-1 flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold leading-snug">
                    {wo.title}
                  </span>
                  {wo.completed && (
                    <span className="shrink-0 text-[10px] font-medium text-accent">
                      ✓ Done
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {wo.distanceMiles != null && formatMiles(wo.distanceMiles)}
                  {wo.distanceMiles != null && wo.durationMin != null && " · "}
                  {wo.durationMin != null && formatDuration(wo.durationMin)}
                  {wo.targetPace && (
                    <span className="text-accent/90"> · {wo.targetPace}</span>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] font-medium text-accent/80">
                  Tap for full details
                </p>
              </button>
            </li>
          ))}
        </ul>
      </section>

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
                  Week {week.weekNumber}
                  {week.focus ? ` · ${week.focus}` : ""}
                </p>
                <h2
                  id={titleId}
                  className="mt-1 text-lg font-bold leading-snug"
                >
                  {selected.title}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {dayName(selected.dayOfWeek)},{" "}
                  {formatShortDate(parseLocalDateKey(selected.dateKey))}
                  {selected.isToday && (
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
                {workoutTypeLabel(selected.type)}
              </span>
              {selected.completed && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-muted">
                  Marked complete
                </span>
              )}
            </div>

            <dl className="space-y-3 text-sm">
              {selected.distanceMiles != null && (
                <div>
                  <dt className="text-xs text-muted">Distance</dt>
                  <dd className="font-medium">
                    {formatMiles(selected.distanceMiles)}
                  </dd>
                </div>
              )}
              {selected.durationMin != null && (
                <div>
                  <dt className="text-xs text-muted">Duration</dt>
                  <dd className="font-medium">
                    {formatDuration(selected.durationMin)}
                  </dd>
                </div>
              )}
              {selected.targetPace && (
                <div>
                  <dt className="text-xs text-muted">Suggested pace</dt>
                  <dd className="font-medium text-accent">
                    {selected.targetPace}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Details</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {selected.description?.trim() ||
                    "No extra notes for this day. Open the Plan tab or ask your coach for more structure."}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/plan"
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-card-border text-sm font-semibold text-accent"
              >
                Open Plan
              </Link>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-black"
                style={{ color: "#0b0f14" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
