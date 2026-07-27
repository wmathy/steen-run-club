import { NextResponse } from "next/server";
import { AuthError, requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { handleRouteError, parseJsonBody } from "@/lib/http";
import { coachProfileUpdateSchema } from "@/lib/validation";

export async function GET() {
  try {
    const userId = await requireUserId();
    const profile = await prisma.coachProfile.findUnique({ where: { userId } });
    return NextResponse.json({ profile });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = await parseJsonBody(req);
    if ("error" in parsed) return parsed.error;

    const result = coachProfileUpdateSchema.safeParse(parsed.data);
    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error.issues[0]?.message ?? "Invalid profile data",
        },
        { status: 400 },
      );
    }

    const data = result.data;
    const profile = await prisma.coachProfile.upsert({
      where: { userId },
      create: {
        userId,
        summary: data.summary ?? "",
        goals: data.goals ?? "",
        injuries: data.injuries ?? "",
        preferences: data.preferences ?? "",
        raceCalendar: data.raceCalendar ?? "",
        fitnessLevel: data.fitnessLevel ?? "",
        schedule: data.schedule ?? "",
        coachingStyle: data.coachingStyle ?? "concise",
      },
      update: data,
    });

    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleRouteError(err);
  }
}
