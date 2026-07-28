import { NextResponse } from "next/server";
import {
  AuthValidationError,
  changePassword,
} from "@/lib/auth";
import { AuthError } from "@/lib/session";
import { getClientIp, handleRouteError, parseJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const limited = rateLimit(`change-pw:${ip}`, 10, 15 * 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 },
      );
    }

    const parsed = await parseJsonBody<{
      currentPassword?: string;
      newPassword?: string;
    }>(req);
    if ("error" in parsed) return parsed.error;

    await changePassword({
      currentPassword: String(parsed.data.currentPassword ?? ""),
      newPassword: String(parsed.data.newPassword ?? ""),
    });

    return NextResponse.json({ ok: true, message: "Password updated." });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof AuthValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleRouteError(err);
  }
}
