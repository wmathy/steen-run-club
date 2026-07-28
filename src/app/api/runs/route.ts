import { after } from "next/server";
import { NextResponse } from "next/server";
import { AuthError, requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { handleRouteError, parseJsonBody } from "@/lib/http";
import {
  clampLimit,
  createRunSchema,
  parseIsoDateAtNoon,
} from "@/lib/validation";
import { schedulePostRunCoachFeedback } from "@/lib/post-run-coach";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const { searchParams } = new URL(req.url);
    const limit = clampLimit(searchParams.get("limit"), 50, 1, 200);

    const runs = await prisma.run.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: limit,
    });

    return NextResponse.json({ runs });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const parsed = await parseJsonBody(req);
    if ("error" in parsed) return parsed.error;

    // Coerce numeric fields that may arrive as strings from forms
    const raw = parsed.data as Record<string, unknown>;
    const candidate = {
      date: raw.date,
      distanceMiles:
        typeof raw.distanceMiles === "string"
          ? Number(raw.distanceMiles)
          : raw.distanceMiles,
      durationMin:
        raw.durationMin === "" || raw.durationMin == null
          ? undefined
          : typeof raw.durationMin === "string"
            ? Number(raw.durationMin)
            : raw.durationMin,
      type: raw.type,
      notes:
        typeof raw.notes === "string" && raw.notes.length > 0
          ? raw.notes
          : undefined,
      perceivedEffort:
        raw.perceivedEffort === "" || raw.perceivedEffort == null
          ? undefined
          : typeof raw.perceivedEffort === "string"
            ? Number(raw.perceivedEffort)
            : raw.perceivedEffort,
    };

    const result = createRunSchema.safeParse(candidate);
    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error.issues[0]?.message ?? "Invalid run data",
        },
        { status: 400 },
      );
    }

    const input = result.data;

    let date: Date;
    try {
      date = parseIsoDateAtNoon(input.date);
    } catch {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const run = await prisma.run.create({
      data: {
        userId,
        date,
        distanceMiles: input.distanceMiles,
        durationMin: input.durationMin ?? null,
        type: input.type,
        notes: input.notes ?? null,
        perceivedEffort: input.perceivedEffort ?? null,
        source: "manual",
      },
    });

    after(() =>
      schedulePostRunCoachFeedback(userId, [
        {
          id: run.id,
          date: run.date,
          distanceMiles: run.distanceMiles,
          durationMin: run.durationMin,
          type: run.type,
          notes: run.notes,
          perceivedEffort: run.perceivedEffort,
          source: run.source,
        },
      ]),
    );

    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleRouteError(err);
  }
}
