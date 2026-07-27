import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { handleRouteError } from "@/lib/http";

export async function GET() {
  try {
    const userId = await requireUserId();
    const plan = await prisma.trainingPlan.findFirst({
      where: { userId, isActive: true },
      include: {
        weeks: {
          orderBy: { weekNumber: "asc" },
          include: {
            workouts: { orderBy: { dayOfWeek: "asc" } },
          },
        },
      },
    });

    return NextResponse.json({ plan });
  } catch (err) {
    return handleRouteError(err);
  }
}
