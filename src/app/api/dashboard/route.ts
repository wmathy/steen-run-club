import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { handleRouteError } from "@/lib/http";

export async function GET() {
  try {
    const userId = await requireUserId();
    const now = new Date();
    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 7);
    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 30);

    const [runs7, runs30, recentRuns, plan, profile] = await Promise.all([
      prisma.run.findMany({
        where: { userId, date: { gte: d7 } },
        orderBy: { date: "desc" },
      }),
      prisma.run.findMany({
        where: { userId, date: { gte: d30 } },
        orderBy: { date: "desc" },
      }),
      prisma.run.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 5,
      }),
      prisma.trainingPlan.findFirst({
        where: { userId, isActive: true },
        include: {
          weeks: {
            orderBy: { weekNumber: "asc" },
            include: {
              workouts: { orderBy: { dayOfWeek: "asc" } },
            },
          },
        },
      }),
      prisma.coachProfile.findUnique({ where: { userId } }),
    ]);

    const sumMiles = (runs: { distanceMiles: number }[]) =>
      runs.reduce((s, r) => s + r.distanceMiles, 0);

    const upcoming: Array<{
      title: string;
      type: string;
      dayOfWeek: number;
      weekNumber: number;
      distanceMiles: number | null;
      durationMin: number | null;
      description: string | null;
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
              description: wo.description,
            });
          }
          if (upcoming.length >= 7) break;
        }
        if (upcoming.length >= 7) break;
      }
    }

    return NextResponse.json({
      mileage: {
        last7Days: Math.round(sumMiles(runs7) * 10) / 10,
        last30Days: Math.round(sumMiles(runs30) * 10) / 10,
        runCount7: runs7.length,
        runCount30: runs30.length,
      },
      recentRuns,
      plan: plan
        ? { id: plan.id, title: plan.title, goal: plan.goal }
        : null,
      upcoming,
      profile,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
