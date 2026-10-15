import { randomUUID } from "crypto";
import { generateText } from "ai";
import { xai } from "@ai-sdk/xai";
import { prisma } from "@/lib/prisma";
import { buildCoachSystemPrompt } from "@/lib/coach-prompt";
import { appendChatTurn } from "@/lib/messages";
import { withUserLock } from "@/lib/mutex";
import { formatMiles, workoutDateKey } from "@/lib/utils";
import { DEFAULT_COACH_TIME_ZONE } from "@/lib/clock";
import {
  attachStravaReviews,
  isStravaConfigured,
  syncStravaRunsForUser,
} from "@/lib/strava";

export type WorkoutCompletionStatus = "as_planned" | "modified";

function runDateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function paceMinPerMile(
  distanceMiles: number,
  durationMin: number | null,
): number | null {
  if (durationMin == null || !(distanceMiles > 0) || !(durationMin > 0)) {
    return null;
  }
  return Math.round((durationMin / distanceMiles) * 100) / 100;
}

function formatPace(minPerMile: number | null): string {
  if (minPerMile == null) return "n/a";
  const m = Math.floor(minPerMile);
  const s = Math.round((minPerMile - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}/mi`;
}

/**
 * After the athlete checks "as planned" or "modified" on a plan workout,
 * pull latest Strava if connected, match runs to that day, and have the coach
 * reply in chat like a real coach would.
 */
export async function generatePlanWorkoutCheckIn(
  userId: string,
  workoutId: string,
  status: WorkoutCompletionStatus,
  options?: { timeZone?: string | null; dateKey?: string | null },
): Promise<void> {
  try {
    if (!process.env.XAI_API_KEY) {
      console.warn("[plan-checkin] XAI_API_KEY missing; skip coach message");
      return;
    }

    await withUserLock(`plan-checkin:${userId}`, async () => {
      const workout = await prisma.planWorkout.findFirst({
        where: {
          id: workoutId,
          week: { plan: { userId, isActive: true } },
        },
        include: {
          week: {
            include: {
              plan: true,
            },
          },
        },
      });

      if (!workout) {
        console.warn("[plan-checkin] workout not found", workoutId);
        return;
      }

      const plan = workout.week.plan;
      // Prefer the calendar day the athlete saw/tapped in the UI.
      // Fall back to plan math (week + dayOfWeek), then optional stored workout.date.
      const fromClient =
        options?.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(options.dateKey.trim())
          ? options.dateKey.trim()
          : null;
      const dateIso =
        fromClient ??
        workoutDateKey(
          plan.startDate,
          workout.week.weekNumber,
          workout.dayOfWeek,
        );

      // Best-effort Strava pull so today's activity is available (no auto-debrief)
      try {
        if (isStravaConfigured()) {
          const conn = await prisma.stravaConnection.findUnique({
            where: { userId },
          });
          if (conn) {
            await syncStravaRunsForUser(userId, {
              skipCoachDebrief: true,
              fullDays: 14,
            });
          }
        }
      } catch (err) {
        console.warn("[plan-checkin] Strava sync skipped:", err);
      }

      // Match runs on this calendar day (UTC noon storage → ISO date key)
      const dayStart = new Date(`${dateIso}T00:00:00.000Z`);
      const dayEnd = new Date(`${dateIso}T23:59:59.999Z`);
      // Also include local-noon range padding for edge storage
      const padStart = new Date(dayStart.getTime() - 12 * 3600_000);
      const padEnd = new Date(dayEnd.getTime() + 12 * 3600_000);

      const dayRuns = await prisma.run.findMany({
        where: {
          userId,
          date: { gte: padStart, lte: padEnd },
        },
        orderBy: { date: "desc" },
      });

      const matchingRuns = dayRuns.filter((r) => runDateKey(r.date) === dateIso);
      let reviewedRuns = matchingRuns.map((run) => ({
        ...run,
        stravaReview: null as string | null,
      }));
      try {
        reviewedRuns = await attachStravaReviews(userId, reviewedRuns, {
          onlyDebrief: false,
        });
      } catch (err) {
        console.warn(
          "[plan-checkin] Strava workout detail skipped:",
          err instanceof Error ? err.message : "unavailable",
        );
      }

      const profile = await prisma.coachProfile.findUnique({
        where: { userId },
      });

      const timeZone = options?.timeZone || DEFAULT_COACH_TIME_ZONE;
      const statusLabel =
        status === "as_planned"
          ? "Completed run as planned"
          : "Modified today's run";

      const plannedBlock = [
        `Title: ${workout.title}`,
        `Type: ${workout.type}`,
        `Plan date: ${dateIso}`,
        `Week ${workout.week.weekNumber}`,
        workout.distanceMiles != null
          ? `Planned distance: ${formatMiles(workout.distanceMiles)}`
          : null,
        workout.durationMin != null
          ? `Planned duration: ${workout.durationMin} min`
          : null,
        workout.targetPace ? `Target pace: ${workout.targetPace}` : null,
        workout.description ? `Description: ${workout.description}` : null,
        `Athlete mark: ${statusLabel}`,
      ]
        .filter(Boolean)
        .join("\n");

      const runsBlock =
        reviewedRuns.length === 0
          ? "No logged run found for this calendar day (Strava or manual). Ask how it went if needed."
          : reviewedRuns
              .map((r) => {
                const pace = paceMinPerMile(r.distanceMiles, r.durationMin);
                const basic =
                  `- ${runDateKey(r.date)} · ${formatMiles(r.distanceMiles)}` +
                  (r.durationMin != null ? ` · ${r.durationMin} min` : "") +
                  ` · ${formatPace(pace)} · ${r.type} · source=${r.source}` +
                  (r.perceivedEffort != null ? ` · RPE ${r.perceivedEffort}/10` : "") +
                  (r.notes ? ` · notes: ${r.notes}` : "");
                return r.stravaReview
                  ? `${basic}\nStrava workout detail:\n${r.stravaReview}`
                  : basic;
              })
              .join("\n");

      const system =
        buildCoachSystemPrompt(profile, { timeZone }) +
        `

## Plan day check-in mode (this message only)
The athlete just marked a planned workout from the Plan tab. Write ONE conversational coach message in chat.

### Athlete status
- **as_planned**: They say they did the workout as prescribed. Compare to any Strava/manual run data for that day. Celebrate consistency. If data matches, affirm it. If data is missing, still acknowledge the mark and ask one light question if useful (how it felt, legs, life). If data clearly diverges a lot from the plan, gently notice and ask what changed — no scolding.
- **modified**: They intentionally changed today's run, or it didn't match the plan. Look at Strava/manual data vs the plan. Ask what changed if it isn't obvious. Stay supportive. If they did less than planned, you may suggest an optional make-up — never demand it, never guilt them, and do not say you changed their plan. This check-in does not edit the stored plan.

### Rules
1. Sound like a real running coach texting them — warm, specific, not a report.
2. Use the matched run data when present (distance, pace, source). Prefer Strava when available. Do not invent paces or distances.
3. If a run has a "Strava workout detail" block, that is the device data. Apply the Strava workout detail rules: pace consistency and negative splits, how any intervals compared with this planned workout, heart-rate effort and drift, and whether elevation explains a slower stretch. Skip whatever the block says was not recorded.
4. Stay in their coaching style length/voice. Encouraging, not a dictator.
5. One message only. End ready for a reply if you asked a question.
6. Do not mention tools, APIs, or "checking Strava" as a system — you can say "looking at what you logged" naturally if needed.
7. This check-in still does not edit the stored plan. Detail in the run is not consent to add miles or rewrite the week.`;

      const userPrompt = `Plan day check-in:

## Planned workout
${plannedBlock}

## Matching run log for ${dateIso}
${runsBlock}

Write your coach message now. If a Strava workout detail block is present, coach from that detail against the planned workout.`;

      // No tools: all plan + run context is already in the prompt. Tools-only
      // model turns can leave result.text empty and drop the coach message.
      const result = await generateText({
        model: xai.chat("grok-4.5"),
        system,
        prompt: userPrompt,
      });

      const text = (result.text || "").trim();
      if (!text) {
        console.warn("[plan-checkin] empty model text");
        return;
      }

      await appendChatTurn(userId, [
        {
          id: randomUUID(),
          role: "assistant",
          parts: [{ type: "text", text }],
        },
      ]);

      console.info(
        `[plan-checkin] coach replied for workout ${workoutId} (${status}, runs=${matchingRuns.length})`,
      );
    });
  } catch (err) {
    console.error("[plan-checkin] failed:", err);
  }
}

/** Prefer awaiting via next/server after() from route handlers. */
export function schedulePlanWorkoutCheckIn(
  userId: string,
  workoutId: string,
  status: WorkoutCompletionStatus,
  options?: { timeZone?: string | null; dateKey?: string | null },
): Promise<void> {
  return generatePlanWorkoutCheckIn(userId, workoutId, status, options);
}
