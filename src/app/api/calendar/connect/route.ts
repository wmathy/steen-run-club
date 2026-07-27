import { NextResponse } from "next/server";
import { AuthError, requireUserId } from "@/lib/session";
import {
  createOAuthState,
  getGoogleAuthUrl,
  isGoogleConfigured,
} from "@/lib/google-calendar";

export async function GET() {
  try {
    const userId = await requireUserId();

    if (!isGoogleConfigured()) {
      return NextResponse.json(
        {
          configured: false,
          error:
            "Google Calendar OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        },
        { status: 503 },
      );
    }

    const state = await createOAuthState(userId);
    const url = getGoogleAuthUrl(state);
    return NextResponse.json({ configured: true, url });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Calendar connect error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
