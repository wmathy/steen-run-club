import { NextResponse } from "next/server";
import { requireUserId, AuthError } from "@/lib/session";
import { disconnectStrava } from "@/lib/strava";
import { handleRouteError } from "@/lib/http";

export async function POST() {
  try {
    const userId = await requireUserId();
    await disconnectStrava(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleRouteError(err);
  }
}
