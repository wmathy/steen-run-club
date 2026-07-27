import { NextResponse } from "next/server";
import {
  AuthConflictError,
  AuthValidationError,
  createUser,
  loginUser,
} from "@/lib/auth";
import { getClientIp, parseJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limited = rateLimit(`signup:${ip}`, 10, 15 * 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  const parsed = await parseJsonBody<{
    email?: string;
    password?: string;
    name?: string;
  }>(req);
  if ("error" in parsed) return parsed.error;

  const { email, password, name } = parsed.data;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  try {
    await createUser({ email, password, name });
    await loginUser(email, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof AuthValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Signup error:", err);
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}
