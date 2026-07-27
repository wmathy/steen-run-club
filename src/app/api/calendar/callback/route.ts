import { NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  isGoogleConfigured,
  storeGoogleTokens,
  verifyOAuthState,
} from "@/lib/google-calendar";

export async function GET(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(
      `${appUrl}/settings?calendar=not_configured`,
    );
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?calendar=error`);
  }

  try {
    const verified = await verifyOAuthState(state);
    if (!verified) {
      return NextResponse.redirect(`${appUrl}/settings?calendar=error`);
    }

    const tokens = await exchangeCodeForTokens(code);
    await storeGoogleTokens(verified.userId, tokens);

    return NextResponse.redirect(`${appUrl}/settings?calendar=connected`);
  } catch (e) {
    console.error("Google OAuth callback error:", e);
    return NextResponse.redirect(`${appUrl}/settings?calendar=error`);
  }
}
