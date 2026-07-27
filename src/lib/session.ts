import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = {
  userId?: string;
  email?: string;
  name?: string;
  isLoggedIn: boolean;
  /** One-time OAuth state nonce for Google Calendar connect */
  oauthState?: string;
  oauthStateExp?: number;
};

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 characters",
    );
  }
  return secret;
}

function isSecureCookie(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return appUrl.startsWith("https://");
}

export function getSessionOptions(): SessionOptions {
  return {
    password: requireSessionSecret(),
    cookieName: "running_coach_session",
    cookieOptions: {
      secure: isSecureCookie(),
      httpOnly: true,
      sameSite: "lax",
      // 14 days — long enough for MVP UX; rotate later with session versioning
      maxAge: 60 * 60 * 24 * 14,
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

export async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    throw new AuthError("Unauthorized");
  }
  return session.userId;
}

export class AuthError extends Error {
  status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}
