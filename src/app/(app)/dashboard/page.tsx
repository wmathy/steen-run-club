import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  dayName,
  formatDuration,
  formatMiles,
  workoutTypeLabel,
} from "@/lib/utils";

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

  const upcoming: Array<{
    title: string;
    type: string;
    dayOfWeek: number;
    weekNumber: number;
    distanceMiles: number | null;
    durationMin: number | null;
  }> = [];

  if (plan) {
    for (const week of plan.weeks) {
      for (const wo of week.workouts) {
        if (!wo.completed && wo.type !== "rest") {
          upcoming.push({
            title: wo.title,
            type: wo.type,
            dayOfWeek: wo.dayOfWeek,
            weekNumber: week.weekNumber,
            distanceMiles: wo.distanceMiles,
            durationMin: wo.durationMin,
          });
        }
        if (upcoming.length >= 5) break;
      }
      if (upcoming.length >= 5) break;
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

      <div className="grid gap-6 lg:grid-cols-2">
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

        <section className="rounded-2xl border border-card-border bg-card/60 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Upcoming workouts</h2>
            <Link href="/plan" className="text-xs text-accent hover:underline">
              Full plan
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">
              No plan workouts yet. Ask the coach to build a week for you.
            </p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((wo, i) => (
                <li
                  key={`${wo.weekNumber}-${wo.dayOfWeek}-${i}`}
                  className="rounded-lg bg-black/20 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{wo.title}</span>
                    <span className="text-xs text-muted">
                      W{wo.weekNumber} · {dayName(wo.dayOfWeek)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {workoutTypeLabel(wo.type)}
                    {wo.distanceMiles != null &&
                      ` · ${formatMiles(wo.distanceMiles)}`}
                    {wo.durationMin != null &&
                      ` · ${formatDuration(wo.durationMin)}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
