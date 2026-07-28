import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth";
import { getClientIp, handleRouteError, parseJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const limited = rateLimit(`forgot-pw:${ip}`, 5, 15 * 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Too many requests. Try again later." },
        { status: 429 },
      );
    }

    const parsed = await parseJsonBody<{ email?: string }>(req);
    if ("error" in parsed) return parsed.error;

    const result = await requestPasswordReset(String(parsed.data.email ?? ""));
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
