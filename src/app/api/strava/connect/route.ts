import { NextResponse } from "next/server";
import { requireUserId, AuthError } from "@/lib/session";
import { createOAuthState } from "@/lib/oauth-state";
import {
  getStravaAuthUrl,
  isStravaConfigured,
} from "@/lib/strava";
import { handleRouteError } from "@/lib/http";

export async function GET() {
  try {
    const userId = await requireUserId();

    if (!isStravaConfigured()) {
      return NextResponse.json(
        {
          error:
            "Strava is not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env.",
        },
        { status: 503 },
      );
    }

    const state = await createOAuthState(userId);
    const url = getStravaAuthUrl(state);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleRouteError(err);
  }
}
