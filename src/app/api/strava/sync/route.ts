import { NextResponse } from "next/server";
import { requireUserId, AuthError } from "@/lib/session";
import { isStravaConfigured, syncStravaRunsForUser } from "@/lib/strava";
import { prisma } from "@/lib/prisma";
import { handleRouteError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export async function POST() {
  try {
    const userId = await requireUserId();

    if (!isStravaConfigured()) {
      return NextResponse.json(
        { error: "Strava is not configured on this server." },
        { status: 503 },
      );
    }

    const conn = await prisma.stravaConnection.findUnique({
      where: { userId },
    });
    if (!conn) {
      return NextResponse.json(
        { error: "Connect Strava first in Settings." },
        { status: 400 },
      );
    }

    // Prevent spam syncing (rate limit per user)
    const limited = rateLimit(`strava-sync:${userId}`, 10, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many sync requests. Try again in a minute." },
        { status: 429 },
      );
    }

    const result = await syncStravaRunsForUser(userId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    const message =
      err instanceof Error &&
      (err.message.includes("reconnect") || err.message.includes("not connected"))
        ? err.message
        : "Strava sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
