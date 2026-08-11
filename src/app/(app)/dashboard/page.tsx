import Link from "next/link";
import { DashboardUpcoming } from "@/components/dashboard-upcoming";
import type { DashboardWeek } from "@/components/dashboard-upcoming";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  formatMiles,
  formatWeekRange,
  weekDateRange,
  workoutDate,
  workoutTypeLabel,
} from "@/lib/utils";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

function localToday(): Date {
  return startOfLocalDay(new Date());
}

function dateKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Prefer the plan week that contains today; otherwise nearest week
 * (next future week, or last week if plan already ended).
 */
function resolveCurrentWeek<
  T extends {
    weekNumber: number;
    focus: string | null;
    workouts: Array<{
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
    }>;
  },
>(
  planStart: Date,
  weeks: T[],
): { week: T; rangeLabel: string } | null {
  if (!weeks.length) return null;
  const today = localToday().getTime();

  for (const week of weeks) {
    const { start, end } = weekDateRange(planStart, week.weekNumber);
    const startT = startOfLocalDay(start).getTime();
    const endT = startOfLocalDay(end).getTime();
    if (today >= startT && today <= endT) {
      return {
        week,
        rangeLabel: formatWeekRange(start, end),
      };
    }
  }

  // Next week that starts after today
  for (const week of weeks) {
    const { start, end } = weekDateRange(planStart, week.weekNumber);
    if (startOfLocalDay(start).getTime() > today) {
      return { week, rangeLabel: formatWeekRange(start, end) };
    }
  }

  // Plan fully in the past — show last week
  const last = weeks[weeks.length - 1]!;
  const { start, end } = weekDateRange(planStart, last.weekNumber);
  return { week: last, rangeLabel: formatWeekRange(start, end) };
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const now = new Date();
  const d7 = new Date(now);
  d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);

  const [runs7, runs30, recentRuns, plan] = await Promise.all([
    prisma.run.findMany({
      where: { userId: user.id, date: { gte: d7 } },
    }),
    prisma.run.findMany({
      where: { userId: user.id, date: { gte: d30 } },
    }),
    prisma.run.findMany({
      where: { userId: user.id },
      orderBy: { date: "desc" },
      take: 5,
    }),
    prisma.trainingPlan.findFirst({
      where: { userId: user.id, isActive: true },
      include: {
        weeks: {
          orderBy: { weekNumber: "asc" },
          include: { workouts: { orderBy: { dayOfWeek: "asc" } } },
        },
      },
    }),
  ]);

  const miles7 = runs7.reduce((s, r) => s + r.distanceMiles, 0);
  const miles30 = runs30.reduce((s, r) => s + r.distanceMiles, 0);

  const today = localToday();
  let currentWeek: DashboardWeek | null = null;

  if (plan) {
    const resolved = resolveCurrentWeek(plan.startDate, plan.weeks);
    if (resolved) {
      const { week, rangeLabel } = resolved;
      const workouts = [...week.workouts]
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((wo) => {
          const date = workoutDate(
            plan.startDate,
            week.weekNumber,
            wo.dayOfWeek,
          );
          const day = startOfLocalDay(date);
          const isToday =
            day.getFullYear() === today.getFullYear() &&
            day.getMonth() === today.getMonth() &&
            day.getDate() === today.getDate();
          const isPast = day.getTime() < today.getTime() && !isToday;
          return {
            id: wo.id,
            dayOfWeek: wo.dayOfWeek,
            type: wo.type,
            title: wo.title,
            description: wo.description,
            distanceMiles: wo.distanceMiles,
            durationMin: wo.durationMin,
            targetPace: wo.targetPace,
            completed: wo.completed,
            completionStatus: wo.completionStatus,
            dateKey: dateKeyLocal(day),
            isToday,
            isPast,
          };
        });

      currentWeek = {
        weekNumber: week.weekNumber,
        focus: week.focus,
        rangeLabel,
        workouts,
      };
    }
  }

  const greeting = user.name ? `Hey, ${user.name.split(" ")[0]}` : "Hey there";

  return (
    <div className="mobile-page mx-auto w-full max-w-5xl space-y-5 p-3 sm:space-y-6 sm:p-4 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {greeting}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Your training snapshot. Open the coach for daily guidance.
          </p>
        </div>
        <Link
          href="/chat"
          className="flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-black shadow-lg shadow-accent/10 sm:w-auto sm:min-h-0 sm:py-2.5"
          style={{ color: "#0b0f14" }}
        >
          Talk to coach
        </Link>
      </div>

      {/* Stats: plan + goals are in this grid — week sits directly below on phone */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {[
          {
            label: "Last 7 days",
            value: formatMiles(Math.round(miles7 * 10) / 10),
            sub: `${runs7.length} run${runs7.length === 1 ? "" : "s"}`,
          },
          {
            label: "Last 30 days",
            value: formatMiles(Math.round(miles30 * 10) / 10),
            sub: `${runs30.length} run${runs30.length === 1 ? "" : "s"}`,
          },
          {
            label: "Active plan",
            value: plan?.title ?? "None",
            sub: plan?.goal ?? "Build one in chat",
          },
          {
            label: "Goals",
            value: user.coachProfile?.goals
              ? user.coachProfile.goals.slice(0, 40) +
                (user.coachProfile.goals.length > 40 ? "…" : "")
              : "Not set",
            sub: "From coach memory",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-card-border bg-card/80 p-4"
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted">
              {card.label}
            </div>
            <div className="mt-2 truncate text-lg font-semibold">
              {card.value}
            </div>
            <div className="mt-1 truncate text-xs text-muted">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Current week workouts — immediately under plan/goals cards */}
      <DashboardUpcoming week={currentWeek} />

      <section className="rounded-2xl border border-card-border bg-card/60 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent runs</h2>
          <Link href="/runs" className="text-xs text-accent hover:underline">
            View all
          </Link>
        </div>
        {recentRuns.length === 0 ? (
          <p className="text-sm text-muted">
            No runs yet.{" "}
            <Link href="/runs" className="text-accent hover:underline">
              Log your first run
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {recentRuns.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-2 text-sm"
              >
                <span className="text-muted">
                  {run.date.toISOString().slice(0, 10)}
                </span>
                <span className="font-medium">
                  {formatMiles(run.distanceMiles)}
                </span>
                <span className="text-xs uppercase text-muted">
                  {workoutTypeLabel(run.type)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
