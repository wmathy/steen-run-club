import { NextResponse } from "next/server";
import { AuthValidationError, resetPasswordWithToken } from "@/lib/auth";
import { getClientIp, handleRouteError, parseJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const limited = rateLimit(`reset-pw:${ip}`, 10, 15 * 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 },
      );
    }

    const parsed = await parseJsonBody<{
      token?: string;
      newPassword?: string;
    }>(req);
    if ("error" in parsed) return parsed.error;

    await resetPasswordWithToken({
      token: String(parsed.data.token ?? ""),
      newPassword: String(parsed.data.newPassword ?? ""),
    });

    return NextResponse.json({
      ok: true,
      message: "Password updated. You can sign in now.",
    });
  } catch (err) {
    if (err instanceof AuthValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleRouteError(err);
  }
}
