import { NextResponse } from "next/server";
import {
  getStravaWebhookVerifyToken,
  importStravaActivityById,
  isStravaConfigured,
} from "@/lib/strava";

/**
 * Strava webhook subscription callback.
 * GET — subscription validation (hub.challenge)
 * POST — activity create/update/delete events
 *
 * Register once (public HTTPS URL required):
 *   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
 *     -F client_id=... -F client_secret=... \
 *     -F callback_url=https://YOUR_DOMAIN/api/strava/webhook \
 *     -F verify_token=YOUR_STRAVA_WEBHOOK_VERIFY_TOKEN
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token === getStravaWebhookVerifyToken() &&
    challenge
  ) {
    return NextResponse.json({ "hub.challenge": challenge });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

type WebhookEvent = {
  object_type?: string;
  object_id?: number;
  aspect_type?: string;
  owner_id?: number;
  subscription_id?: number;
  event_time?: number;
};

export async function POST(req: Request) {
  if (!isStravaConfigured()) {
    return new NextResponse(null, { status: 204 });
  }

  // Always 200 quickly so Strava does not disable the subscription.
  // Process asynchronously after reading body.
  let body: WebhookEvent;
  try {
    body = (await req.json()) as WebhookEvent;
  } catch {
    return new NextResponse(null, { status: 200 });
  }

  // Handle deauthorization events
  if (
    body.object_type === "athlete" &&
    body.aspect_type === "update"
  ) {
    // Could clear tokens if updates.authorized === false — skip for MVP
    return new NextResponse(null, { status: 200 });
  }

  if (
    body.object_type === "activity" &&
    typeof body.object_id === "number" &&
    typeof body.owner_id === "number" &&
    typeof body.aspect_type === "string"
  ) {
    // Fire-and-forget; do not await long Strava API calls before responding
    void importStravaActivityById(
      body.owner_id,
      body.object_id,
      body.aspect_type,
    ).catch((err) => console.error("Strava webhook import failed:", err));
  }

  return new NextResponse(null, { status: 200 });
}
