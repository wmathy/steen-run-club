import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto-tokens";
import { withUserLock } from "@/lib/mutex";

const STRAVA_AUTH = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN = "https://www.strava.com/oauth/token";
const STRAVA_API = "https://www.strava.com/api/v3";
const STRAVA_DEAUTH = "https://www.strava.com/oauth/deauthorize";

export function isStravaConfigured(): boolean {
  return Boolean(
    process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET,
  );
}

/**
 * Must match Strava API "Authorization Callback Domain" + path exactly.
 * Live: Authorization Callback Domain = steen-run-club.vercel.app
 *       redirect_uri = https://steen-run-club.vercel.app/api/strava/callback
 */
export function getStravaRedirectUri(): string {
  const explicit = process.env.STRAVA_REDIRECT_URI?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}/api/strava/callback`;
}

export function getStravaWebhookVerifyToken(): string {
  return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "steen_strava_webhook";
}

/** Scopes: activity:read required for webhooks; activity:read_all for private runs. */
const SCOPES = "read,activity:read,activity:read_all";

export function getStravaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: getStravaRedirectUri(),
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPES,
    state,
  });
  return `${STRAVA_AUTH}?${params.toString()}`;
}

type TokenResponse = {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  athlete?: { id: number };
};

export async function exchangeStravaCode(code: string): Promise<TokenResponse> {
  const res = await fetch(STRAVA_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Number(process.env.STRAVA_CLIENT_ID),
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      // Must match the authorize step redirect_uri exactly
      redirect_uri: getStravaRedirectUri(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Strava token exchange failed:", text.slice(0, 300));
    throw new Error("Strava authorization failed");
  }
  return res.json() as Promise<TokenResponse>;
}

export async function storeStravaTokens(
  userId: string,
  tokens: TokenResponse,
  scopes: string,
) {
  if (!tokens.athlete?.id) {
    throw new Error("Strava response missing athlete id");
  }
  const athleteId = BigInt(tokens.athlete.id);
  const data = {
    athleteId,
    accessToken: encryptSecret(tokens.access_token),
    refreshToken: encryptSecret(tokens.refresh_token),
    expiryDate: new Date(tokens.expires_at * 1000),
    scopes,
  };

  await prisma.stravaConnection.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

async function refreshAccessToken(
  userId: string,
  refreshTokenPlain: string,
): Promise<string> {
  const res = await fetch(STRAVA_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Number(process.env.STRAVA_CLIENT_ID),
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshTokenPlain,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Strava token refresh failed:", text.slice(0, 300));
    throw new Error("Strava session expired — reconnect in Settings");
  }
  const tokens = (await res.json()) as TokenResponse;
  await prisma.stravaConnection.update({
    where: { userId },
    data: {
      accessToken: encryptSecret(tokens.access_token),
      refreshToken: encryptSecret(tokens.refresh_token),
      expiryDate: new Date(tokens.expires_at * 1000),
    },
  });
  return tokens.access_token;
}

export async function getValidStravaAccessToken(userId: string): Promise<string> {
  const conn = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (!conn) throw new Error("Strava is not connected");

  const accessToken = decryptSecret(conn.accessToken);
  const refreshToken = decryptSecret(conn.refreshToken);
  // Refresh if expiring within 5 minutes
  if (conn.expiryDate.getTime() <= Date.now() + 5 * 60_000) {
    return refreshAccessToken(userId, refreshToken);
  }
  return accessToken;
}

export async function disconnectStrava(userId: string): Promise<void> {
  const conn = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (!conn) return;

  try {
    const accessToken = decryptSecret(conn.accessToken);
    await fetch(STRAVA_DEAUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: accessToken }),
    });
  } catch (err) {
    console.error("Strava deauthorize request failed (continuing):", err);
  }

  await prisma.stravaConnection.delete({ where: { userId } });
}

// ─── Activity import ────────────────────────────────────────────────────────

type StravaActivitySummary = {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number;
  start_date_local: string;
  average_heartrate?: number;
  workout_type?: number | null;
  private?: boolean;
};

function metersToMiles(m: number): number {
  return Math.round((m / 1609.344) * 100) / 100;
}

function secondsToMinutes(s: number): number {
  return Math.round((s / 60) * 10) / 10;
}

/** Map Strava activity type → our run type (null = skip non-run sports) */
export function mapStravaRunType(activity: StravaActivitySummary): string | null {
  const sport = (activity.sport_type || activity.type || "").toLowerCase();
  const allowed = new Set([
    "run",
    "trailrun",
    "virtualrun",
    "walk",
    "hike",
  ]);
  if (!allowed.has(sport)) return null;

  // workout_type: 0 default, 1 race, 2 long run, 3 workout
  if (activity.workout_type === 1) return "race";
  if (activity.workout_type === 2) return "long";
  if (activity.workout_type === 3) return "tempo";

  const name = (activity.name || "").toLowerCase();
  if (name.includes("tempo") || name.includes("threshold")) return "tempo";
  if (
    name.includes("interval") ||
    name.includes("track") ||
    name.includes("repeats")
  )
    return "interval";
  if (name.includes("long")) return "long";
  if (name.includes("recovery") || name.includes("easy")) return "easy";
  if (name.includes("race")) return "race";
  if (sport === "walk" || sport === "hike") return "recovery";
  return "easy";
}

function activityDateLocal(startLocal: string): Date {
  // "2024-01-15T07:30:00Z" or without Z — use date part at noon local storage style
  const day = startLocal.slice(0, 10);
  return new Date(`${day}T12:00:00`);
}

export async function importStravaActivityForUser(
  userId: string,
  activity: StravaActivitySummary,
): Promise<"created" | "updated" | "skipped"> {
  const type = mapStravaRunType(activity);
  if (!type) return "skipped";

  const distanceMiles = metersToMiles(activity.distance);
  if (!(distanceMiles > 0)) return "skipped";

  const stravaActivityId = String(activity.id);
  const notes = `Synced from Strava: ${activity.name}`.slice(0, 4000);
  const durationMin = secondsToMinutes(activity.moving_time || activity.elapsed_time);
  const date = activityDateLocal(activity.start_date_local);

  const existing = await prisma.run.findFirst({
    where: { userId, stravaActivityId },
  });

  if (existing) {
    await prisma.run.update({
      where: { id: existing.id },
      data: {
        date,
        distanceMiles,
        durationMin,
        type,
        notes,
        source: "strava",
      },
    });
    return "updated";
  }

  await prisma.run.create({
    data: {
      userId,
      date,
      distanceMiles,
      durationMin,
      type,
      notes,
      source: "strava",
      stravaActivityId,
    },
  });
  return "created";
}

async function fetchActivity(
  accessToken: string,
  activityId: number,
): Promise<StravaActivitySummary | null> {
  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    console.error("Strava fetch activity failed:", text.slice(0, 300));
    throw new Error("Failed to fetch Strava activity");
  }
  return res.json() as Promise<StravaActivitySummary>;
}

async function listRecentActivities(
  accessToken: string,
  afterUnix?: number,
  perPage = 30,
): Promise<StravaActivitySummary[]> {
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: "1",
  });
  if (afterUnix) params.set("after", String(afterUnix));

  const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Strava list activities failed:", text.slice(0, 300));
    throw new Error("Failed to list Strava activities");
  }
  return res.json() as Promise<StravaActivitySummary[]>;
}

/**
 * Pull recent Strava activities into the run log (deduped by stravaActivityId).
 * Default: last 30 days, or since lastSyncedAt if set.
 */
export async function syncStravaRunsForUser(
  userId: string,
  options?: { fullDays?: number },
): Promise<{ created: number; updated: number; skipped: number }> {
  return withUserLock(`strava:${userId}`, async () => {
    const accessToken = await getValidStravaAccessToken(userId);
    const conn = await prisma.stravaConnection.findUnique({ where: { userId } });
    if (!conn) throw new Error("Strava is not connected");

    const fullDays = options?.fullDays ?? 30;
    let afterUnix: number | undefined;
    if (conn.lastSyncedAt) {
      // small overlap to avoid missing edge activities
      afterUnix = Math.floor(conn.lastSyncedAt.getTime() / 1000) - 3600;
    } else {
      afterUnix = Math.floor(Date.now() / 1000) - fullDays * 24 * 3600;
    }

    const activities = await listRecentActivities(accessToken, afterUnix, 50);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const newRuns: Array<{ date: string; miles: number; type: string; name: string }> =
      [];

    for (const activity of activities) {
      const result = await importStravaActivityForUser(userId, activity);
      if (result === "created") {
        created += 1;
        const t = mapStravaRunType(activity);
        if (t) {
          newRuns.push({
            date: activity.start_date_local.slice(0, 10),
            miles: metersToMiles(activity.distance),
            type: t,
            name: activity.name,
          });
        }
      } else if (result === "updated") updated += 1;
      else skipped += 1;
    }

    await prisma.stravaConnection.update({
      where: { userId },
      data: { lastSyncedAt: new Date() },
    });

    if (newRuns.length > 0) {
      await notifyCoachOfStravaRuns(userId, newRuns);
    }

    return { created, updated, skipped };
  });
}

/** Webhook: import a single activity for the athlete that owns this Strava id */
export async function importStravaActivityById(
  athleteId: number,
  activityId: number,
  aspectType: string,
): Promise<void> {
  const conn = await prisma.stravaConnection.findFirst({
    where: { athleteId: BigInt(athleteId) },
  });
  if (!conn) {
    console.warn("Strava webhook: no user for athlete", athleteId);
    return;
  }

  await withUserLock(`strava:${conn.userId}`, async () => {
    if (aspectType === "delete") {
      await prisma.run.deleteMany({
        where: {
          userId: conn.userId,
          stravaActivityId: String(activityId),
        },
      });
      return;
    }

    const accessToken = await getValidStravaAccessToken(conn.userId);
    const activity = await fetchActivity(accessToken, activityId);
    if (!activity) return;

    const result = await importStravaActivityForUser(conn.userId, activity);
    await prisma.stravaConnection.update({
      where: { userId: conn.userId },
      data: { lastSyncedAt: new Date() },
    });

    if (result === "created") {
      const t = mapStravaRunType(activity);
      if (t) {
        await notifyCoachOfStravaRuns(conn.userId, [
          {
            date: activity.start_date_local.slice(0, 10),
            miles: metersToMiles(activity.distance),
            type: t,
            name: activity.name,
          },
        ]);
      }
    }
  });
}

/**
 * Keep chat clean: do not inject Strava system messages into the conversation.
 * Runs are already in the log; the coach loads them via get_recent_runs.
 * Only note Strava on the coach profile once.
 */
async function notifyCoachOfStravaRuns(
  userId: string,
  _runs: Array<{ date: string; miles: number; type: string; name: string }>,
): Promise<void> {
  const profile = await prisma.coachProfile.findUnique({ where: { userId } });
  const tag = "Strava auto-sync enabled.";
  if (profile) {
    if (!profile.preferences.includes("Strava")) {
      await prisma.coachProfile.update({
        where: { userId },
        data: {
          preferences: [profile.preferences, tag]
            .filter(Boolean)
            .join(" ")
            .slice(0, 4000),
        },
      });
    }
  } else {
    await prisma.coachProfile.create({
      data: {
        userId,
        preferences: tag,
      },
    });
  }
}
