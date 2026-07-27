import { NextResponse } from "next/server";
import { AuthError } from "@/lib/session";

/** Parse JSON body; returns Response on failure. */
export async function parseJsonBody<T = unknown>(
  req: Request,
): Promise<{ data: T } | { error: NextResponse }> {
  try {
    const data = (await req.json()) as T;
    return { data };
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(err: unknown, fallback = "Internal error") {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(fallback, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Client IP best-effort (behind proxies). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}
