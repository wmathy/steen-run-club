import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { handleRouteError } from "@/lib/http";

export async function POST() {
  try {
    const userId = await requireUserId();
    await prisma.googleCalendar.deleteMany({ where: { userId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
