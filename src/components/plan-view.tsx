import Link from "next/link";
import {
  dayName,
  formatDuration,
  formatMiles,
  formatShortDate,
  formatWeekRange,
  weekDateRange,
  workoutDate,
  workoutTypeLabel,
} from "@/lib/utils";

type Workout = {
  id: string;
  dayOfWeek: number;
  type: string;
  title: string;
  description: string | null;
  distanceMiles: number | null;
  durationMin: number | null;
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

function weekMileage(workouts: Workout[]): number {
  return workouts.reduce((sum, wo) => sum + (wo.distanceMiles ?? 0), 0);
}

export function PlanView({ plan }: { plan: Plan | null }) {
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
      </div>

      {plan.weeks.map((week) => {
        const { start, end } = weekDateRange(plan.startDate, week.weekNumber);
        const totalMiles = weekMileage(week.workouts);
        const rounded =
          Math.round(totalMiles * 10) / 10;

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
                return (
                  <article
                    key={wo.id}
                    className="rounded-xl border border-card-border bg-card/60 p-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">
                        {dayName(wo.dayOfWeek)}{" "}
                        <span className="text-muted/80">
                          {formatShortDate(date)}
                        </span>
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
                    </div>
                    {wo.description && (
                      <p className="mt-2 line-clamp-3 text-xs text-muted/90">
                        {wo.description}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
