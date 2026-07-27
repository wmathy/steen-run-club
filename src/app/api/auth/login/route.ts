import { NextResponse } from "next/server";
import { AuthValidationError, loginUser } from "@/lib/auth";
import { getClientIp, parseJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limited = rateLimit(`login:${ip}`, 20, 15 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const parsed = await parseJsonBody<{
    email?: string;
    password?: string;
  }>(req);
  if ("error" in parsed) return parsed.error;

  const { email, password } = parsed.data;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  // Also rate-limit per email
  const emailKey = email.trim().toLowerCase().slice(0, 254);
  const emailLimited = rateLimit(`login-email:${emailKey}`, 10, 15 * 60_000);
  if (!emailLimited.ok) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(emailLimited.retryAfterSec) },
      },
    );
  }

  try {
    await loginUser(email, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthValidationError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("Login error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
