import { NextResponse } from "next/server";
import { verifyOAuthState } from "@/lib/oauth-state";
import {
  exchangeStravaCode,
  isStravaConfigured,
  storeStravaTokens,
  syncStravaRunsForUser,
} from "@/lib/strava";

function appBase(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function GET(req: Request) {
  const base = appBase();

  if (!isStravaConfigured()) {
    return NextResponse.redirect(`${base}/settings?strava=error`);
  }

  const { searchParams } = new URL(req.url);
  const error = searchParams.get("error");
  if (error) {
    return NextResponse.redirect(`${base}/settings?strava=error`);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const scope = searchParams.get("scope") ?? "";

  if (!code || !state) {
    return NextResponse.redirect(`${base}/settings?strava=error`);
  }

  const verified = await verifyOAuthState(state);
  if (!verified) {
    return NextResponse.redirect(`${base}/settings?strava=error`);
  }

  // Require at least activity:read for useful sync
  if (!scope.includes("activity:read")) {
    return NextResponse.redirect(`${base}/settings?strava=scope`);
  }

  try {
    const tokens = await exchangeStravaCode(code);
    await storeStravaTokens(verified.userId, tokens, scope);

    // Initial pull of recent activities (non-fatal if it fails)
    try {
      await syncStravaRunsForUser(verified.userId, { fullDays: 30 });
    } catch (syncErr) {
      console.error("Initial Strava sync failed:", syncErr);
    }

    return NextResponse.redirect(`${base}/settings?strava=connected`);
  } catch (err) {
    console.error("Strava callback failed:", err);
    return NextResponse.redirect(`${base}/settings?strava=error`);
  }
}
