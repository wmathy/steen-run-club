import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { getSession } from "@/lib/session";

/**
 * Create a signed OAuth state bound to the logged-in session.
 * Format: base64url(payload).hmac
 * Payload: userId:nonce:exp
 */
export async function createOAuthState(userId: string): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + 10 * 60 * 1000; // 10 minutes
  const payload = `${userId}:${nonce}:${exp}`;
  const sig = signPayload(payload);
  const state = `${Buffer.from(payload).toString("base64url")}.${sig}`;

  const session = await getSession();
  session.oauthState = nonce;
  session.oauthStateExp = exp;
  await session.save();

  return state;
}

export async function verifyOAuthState(
  state: string,
): Promise<{ userId: string } | null> {
  const [payloadB64, sig] = state.split(".");
  if (!payloadB64 || !sig) return null;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = signPayload(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const [userId, nonce, expStr] = payload.split(":");
  const exp = Number(expStr);
  if (!userId || !nonce || !Number.isFinite(exp) || exp < Date.now()) {
    return null;
  }

  const session = await getSession();
  if (!session.isLoggedIn || session.userId !== userId) {
    return null;
  }
  if (session.oauthState !== nonce) {
    return null;
  }
  if (session.oauthStateExp && session.oauthStateExp < Date.now()) {
    return null;
  }

  // One-time use
  session.oauthState = undefined;
  session.oauthStateExp = undefined;
  await session.save();

  return { userId };
}

function signPayload(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET required for OAuth state");
  }
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
