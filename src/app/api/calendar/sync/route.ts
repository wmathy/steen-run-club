import { NextResponse } from "next/server";
import { AuthError, requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  createEventsFromWorkouts,
  isGoogleConfigured,
} from "@/lib/google-calendar";

export async function POST() {
  try {
    const userId = await requireUserId();

    if (!isGoogleConfigured()) {
      return NextResponse.json(
        { error: "Google Calendar OAuth is not configured on this server." },
        { status: 503 },
      );
    }

    const connection = await prisma.googleCalendar.findUnique({
      where: { userId },
    });
    if (!connection) {
      return NextResponse.json(
        { error: "Connect Google Calendar first." },
        { status: 400 },
      );
    }

    const plan = await prisma.trainingPlan.findFirst({
      where: { userId, isActive: true },
      include: {
        weeks: {
          orderBy: { weekNumber: "asc" },
          include: { workouts: true },
        },
      },
    });

    if (!plan) {
      return NextResponse.json(
        { error: "No active plan to sync." },
        { status: 400 },
      );
    }

    const workouts = plan.weeks.flatMap((w) =>
      w.workouts
        .filter((wo) => wo.type !== "rest")
        .map((wo) => ({
          ...wo,
          weekNumber: w.weekNumber,
          planStart: plan.startDate,
        })),
    );

    const result = await createEventsFromWorkouts(
      userId,
      workouts.slice(0, 28),
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    // Generic client message for unexpected errors
    const message =
      err instanceof Error &&
      (err.message.includes("reconnect") ||
        err.message.includes("not connected"))
        ? err.message
        : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
