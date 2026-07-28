import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto-tokens";
import { withUserLock } from "@/lib/mutex";

export {
  createOAuthState,
  verifyOAuthState,
} from "@/lib/oauth-state";

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function getGoogleRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/calendar/callback`
  );
}

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Google token exchange failed:", text);
    throw new Error("Google authorization failed. Please try connecting again.");
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  }>;
}

export async function storeGoogleTokens(
  userId: string,
  tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  },
) {
  const expiryDate = new Date(Date.now() + tokens.expires_in * 1000);
  const accessToken = encryptSecret(tokens.access_token);
  const refreshToken = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : undefined;

  await prisma.googleCalendar.upsert({
    where: { userId },
    create: {
      userId,
      accessToken,
      refreshToken: refreshToken ?? null,
      expiryDate,
    },
    update: {
      accessToken,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      expiryDate,
    },
  });
}

async function refreshAccessToken(userId: string, refreshTokenPlain: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshTokenPlain,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Google token refresh failed:", text);
    throw new Error(
      "Google Calendar session expired. Please reconnect in Settings.",
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  await prisma.googleCalendar.update({
    where: { userId },
    data: {
      accessToken: encryptSecret(data.access_token),
      expiryDate: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  return data.access_token;
}

export async function getValidAccessToken(userId: string): Promise<string> {
  const conn = await prisma.googleCalendar.findUnique({ where: { userId } });
  if (!conn) throw new Error("Google Calendar not connected");

  const accessToken = decryptSecret(conn.accessToken);
  const refreshToken = conn.refreshToken
    ? decryptSecret(conn.refreshToken)
    : null;

  const expiresSoon =
    !conn.expiryDate || conn.expiryDate.getTime() < Date.now() + 60_000;

  if (expiresSoon) {
    if (!refreshToken) {
      throw new Error(
        "Google Calendar session expired. Please reconnect in Settings.",
      );
    }
    return refreshAccessToken(userId, refreshToken);
  }

  return accessToken;
}

type WorkoutLike = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  distanceMiles: number | null;
  durationMin: number | null;
  date: Date | null;
  dayOfWeek: number;
  weekNumber: number;
  planStart: Date;
  googleEventId?: string | null;
};

function resolveWorkoutDate(wo: WorkoutLike): Date {
  if (wo.date) {
    // Prefer calendar date from stored value (UTC-stable)
    const y = wo.date.getUTCFullYear();
    const m = wo.date.getUTCMonth();
    const d = wo.date.getUTCDate();
    return new Date(y, m, d, 9, 0, 0);
  }

  // Align to Monday-based weeks (same as plan UI)
  const start = new Date(wo.planStart);
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const day = start.getUTCDate();
  const base = new Date(y, m, day, 9, 0, 0);
  const jsDay = base.getDay();
  const offsetToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  base.setDate(base.getDate() + offsetToMonday);
  const dow = Math.min(6, Math.max(0, Math.floor(wo.dayOfWeek)));
  base.setDate(base.getDate() + (wo.weekNumber - 1) * 7 + dow);
  return base;
}

export async function createEventsFromWorkouts(
  userId: string,
  workouts: WorkoutLike[],
): Promise<{ created: number; skipped: number }> {
  // Serialize calendar sync per user to avoid concurrent double-create
  return withUserLock(`calendar:${userId}`, async () => {
    const accessToken = await getValidAccessToken(userId);
    const conn = await prisma.googleCalendar.findUnique({ where: { userId } });
    const calendarId = conn?.calendarId ?? "primary";

    let created = 0;
    let skipped = 0;

    for (const wo of workouts) {
      // Re-check under lock — another sync may have claimed this workout
      const fresh = await prisma.planWorkout.findUnique({
        where: { id: wo.id },
        select: { googleEventId: true },
      });
      if (fresh?.googleEventId || wo.googleEventId) {
        skipped += 1;
        continue;
      }

      const start = resolveWorkoutDate(wo);
      const durationMin = wo.durationMin ?? 60;
      const end = new Date(start.getTime() + durationMin * 60_000);

      const details = [
        wo.description,
        wo.distanceMiles != null ? `Distance: ${wo.distanceMiles} mi` : null,
        `Type: ${wo.type}`,
        "Created by Steen Run Club",
      ]
        .filter(Boolean)
        .join("\n");

      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: `🏃 ${wo.title}`,
            description: details,
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
            extendedProperties: {
              private: {
                runningCoachWorkoutId: wo.id,
              },
            },
          }),
        },
      );

      if (res.ok) {
        const event = (await res.json()) as { id?: string };
        if (event.id) {
          // Conditional claim — only if still null (defense in depth)
          const claimed = await prisma.planWorkout.updateMany({
            where: { id: wo.id, googleEventId: null },
            data: { googleEventId: event.id },
          });
          if (claimed.count === 0) {
            // Lost race after create (should be rare under lock); count as skipped
            skipped += 1;
            continue;
          }
        }
        created += 1;
      } else {
        const text = await res.text();
        console.error("Calendar event create failed:", text);
      }
    }

    return { created, skipped };
  });
}
