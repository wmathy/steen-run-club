import { NextResponse } from "next/server";
import { requireUserId, AuthError } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { handleRouteError, parseJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  schedulePlanWorkoutCheckIn,
  type WorkoutCompletionStatus,
} from "@/lib/plan-checkin";

const STATUSES = new Set(["as_planned", "modified", null]);

/**
 * PATCH — mark a plan workout complete as planned / modified, or clear.
 * Body: { status: "as_planned" | "modified" | null, timeZone?: string }
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId();
    const { id: workoutId } = await ctx.params;

    const parsed = await parseJsonBody<{
      status?: "as_planned" | "modified" | null;
      timeZone?: string;
    }>(req);
    if ("error" in parsed) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const status = parsed.data.status;
    if (status === undefined || !STATUSES.has(status)) {
      return NextResponse.json(
        {
          error:
            'status must be "as_planned", "modified", or null (to clear).',
        },
        { status: 400 },
      );
    }

    const workout = await prisma.planWorkout.findFirst({
      where: {
        id: workoutId,
        week: { plan: { userId, isActive: true } },
      },
      select: {
        id: true,
        type: true,
        completed: true,
        completionStatus: true,
      },
    });

    if (!workout) {
      return NextResponse.json({ error: "Workout not found" }, { status: 404 });
    }

    const limited = rateLimit(`plan-complete:${userId}`, 30, 60 * 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many plan updates. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limited.retryAfterSec) },
        },
      );
    }

    const completed = status !== null;
    const updated = await prisma.planWorkout.update({
      where: { id: workoutId },
      data: {
        completed,
        completionStatus: status,
      },
    });

    // Coach replies only when marking complete (not when clearing)
    const shouldCoach =
      completed &&
      (status === "as_planned" || status === "modified") &&
      // Avoid spam if they re-tap the same status
      !(
        workout.completed &&
        workout.completionStatus === status
      );

    if (shouldCoach) {
      schedulePlanWorkoutCheckIn(
        userId,
        workoutId,
        status as WorkoutCompletionStatus,
        { timeZone: parsed.data.timeZone },
      );
    }

    return NextResponse.json({
      workout: {
        id: updated.id,
        completed: updated.completed,
        completionStatus: updated.completionStatus,
      },
      coachNotified: shouldCoach,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleRouteError(err);
  }
}
