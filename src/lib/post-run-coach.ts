import { randomUUID } from "crypto";
import { generateText, stepCountIs } from "ai";
import { xai } from "@ai-sdk/xai";
import { prisma } from "@/lib/prisma";
import { buildCoachSystemPrompt } from "@/lib/coach-prompt";
import { createCoachTools } from "@/lib/tools";
import { appendChatTurn } from "@/lib/messages";
import { withUserLock } from "@/lib/mutex";
import { formatMiles } from "@/lib/utils";
import { DEFAULT_COACH_TIME_ZONE } from "@/lib/clock";

export type LoggedRunSummary = {
  id: string;
  date: Date | string;
  distanceMiles: number;
  durationMin: number | null;
  type: string;
  notes: string | null;
  perceivedEffort: number | null;
  source: string;
  stravaActivityId?: string | null;
  /** Compact device detail for this debrief. Not stored on the run. */
  stravaReview?: string | null;
};

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

function runDateKey(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function daysAgo(dateKey: string): number {
  const d = new Date(dateKey + "T12:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const then = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((today.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Only debrief "fresh" runs so a 30-day Strava backfill does not flood chat.
 */
export function shouldDebriefRun(run: LoggedRunSummary): boolean {
  if (run.source === "coach") return false; // coach already talking in chat
  return daysAgo(runDateKey(run.date)) <= 5;
}

function describeRun(run: LoggedRunSummary): string {
  const date = runDateKey(run.date);
  const pace = paceMinPerMile(run.distanceMiles, run.durationMin);
  const parts = [
    `Date: ${date}`,
    `Distance: ${formatMiles(run.distanceMiles)}`,
    `Duration: ${run.durationMin != null ? `${run.durationMin} min` : "n/a"}`,
    `Pace: ${formatPace(pace)}`,
    `Type: ${run.type}`,
    `Source: ${run.source}`,
  ];
  if (run.perceivedEffort != null) parts.push(`RPE: ${run.perceivedEffort}/10`);
  if (run.notes) parts.push(`Notes: ${run.notes}`);
  if (run.stravaReview) {
    parts.push(`Strava workout detail:\n${run.stravaReview}`);
  }
  return parts.join("\n");
}

/**
 * After a run is logged (manual or Strava), ask the coach to debrief vs plan,
 * motivate, and adjust the training plan when trends warrant it.
 * Safe to call fire-and-forget; never throws to callers.
 */
export async function generatePostRunCoachFeedback(
  userId: string,
  runsIn: LoggedRunSummary[],
): Promise<void> {
  try {
    if (!process.env.XAI_API_KEY) {
      console.warn("[post-run-coach] XAI_API_KEY missing; skip debrief");
      return;
    }

    const runs = runsIn.filter(shouldDebriefRun);
    if (!runs.length) return;

    // Serialize debriefs per user so bulk Strava syncs don't race
    await withUserLock(`post-run-coach:${userId}`, async () => {
      const profile = await prisma.coachProfile.findUnique({
        where: { userId },
      });

      const recentRuns = await prisma.run.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 14,
      });

      const plan = await prisma.trainingPlan.findFirst({
        where: { userId, isActive: true },
        include: {
          weeks: {
            orderBy: { weekNumber: "asc" },
            include: {
              workouts: { orderBy: { dayOfWeek: "asc" } },
            },
          },
        },
      });

      const recentBlock = recentRuns
        .map((r) => {
          const pace = paceMinPerMile(r.distanceMiles, r.durationMin);
          return `- ${runDateKey(r.date)}: ${formatMiles(r.distanceMiles)}, ${r.durationMin ?? "?"} min, ${formatPace(pace)}, ${r.type}${r.source === "strava" ? " (Strava)" : ""}`;
        })
        .join("\n");

      let planBlock = "No active training plan.";
      if (plan) {
        const lines: string[] = [
          `Title: ${plan.title}`,
          plan.goal ? `Goal: ${plan.goal}` : null,
          `Start: ${runDateKey(plan.startDate)}`,
        ].filter(Boolean) as string[];
        for (const w of plan.weeks) {
          lines.push(`Week ${w.weekNumber}${w.focus ? ` (${w.focus})` : ""}:`);
          for (const wo of w.workouts) {
            lines.push(
              `  day ${wo.dayOfWeek} ${wo.type}: ${wo.title}` +
                (wo.distanceMiles != null
                  ? ` — ${formatMiles(wo.distanceMiles)}`
                  : "") +
                (wo.durationMin != null ? ` / ${wo.durationMin} min` : "") +
                (wo.completed ? " [done]" : ""),
            );
          }
        }
        planBlock = lines.join("\n");
      }

      // Background jobs have no browser timezone; default to US Eastern.
      const timeZone = DEFAULT_COACH_TIME_ZONE;
      const system =
        buildCoachSystemPrompt(profile, { timeZone }) +
        `

## Post-run debrief mode (this message only)
The athlete just logged one or more runs (manual entry or Strava sync). Write ONE conversational coach message that:

1. Comments on how the run(s) went relative to the active plan (distance, type, effort/pace if available). If there is no plan, still react helpfully and suggest building one if needed.
2. Gives honest motivation — encourage consistency without empty cheerleading. If they underperformed due to life/fatigue, be supportive and practical.
3. Looks at the recent run trend (last ~2 weeks): are distances or paces trending clearly below or above what the plan expects?
4. If they missed miles or a workout, you may SUGGEST an optional make-up (short and easy, only if it fits). Never demand it, never guilt them, and do NOT call save_or_update_plan or edit_plan_schedule to add those miles. The stored plan stays put until they agree in chat.
5. If fatigue, pain, or a clear overload trend shows up, you may lower load or swap a future quality day. Say what you are changing, use reason "recovery_adjustment", and do not raise mileage to catch them up.
6. If they are roughly on track, say so and leave the plan alone.
7. Stay in the athlete's selected length style and experience level. Conversational prose — not a report full of bullets. Supportive, not a lecture.
8. Do not invent paces or distances that are not in the data. If pace is n/a, do not critique pace.
9. Do not mark plan workouts complete from this debrief. Talk about the run and, if needed, adjust future sessions only under the rules above.
10. If a run has a "Strava workout detail" block, that block is the device data for the review. Apply the Strava workout detail rules: pace consistency and negative splits, interval execution against the planned workout, heart-rate effort and drift, elevation, and the other recorded fields. Anything marked not recorded stays out of the message. get_recent_runs is only the basic log and does not replace that block.
11. The detail block is not consent to change the plan. Suggest a make-up if they missed work. Do not write the extra miles into the plan.

You may use tools. Your visible reply is what the athlete reads in chat.`;

      const focusBlock = runs.map((r, i) => `### Run ${i + 1}\n${describeRun(r)}`).join("\n\n");

      const userPrompt = `Debrief these newly logged run(s):

${focusBlock}

## Recent training log (for trend)
${recentBlock || "(none)"}

## Active plan
${planBlock}

Write your coach message now. If a Strava workout detail block is present, coach from that detail (pace across the splits, any intervals, heart rate, hills). If they missed work, suggest an optional make-up in this message only. Use plan tools only to lower load or swap a future quality day — never to add missed miles.`;

      const result = await generateText({
        model: xai.chat("grok-4.5"),
        system,
        prompt: userPrompt,
        tools: createCoachTools(userId, { timeZone, mode: "automatic" }),
        stopWhen: stepCountIs(8),
      });

      const text = (result.text || "").trim();
      if (!text) {
        console.warn("[post-run-coach] empty model text");
        return;
      }

      await appendChatTurn(userId, [
        {
          id: randomUUID(),
          role: "assistant",
          parts: [{ type: "text", text }],
        },
      ]);
    });
  } catch (err) {
    console.error("[post-run-coach] failed:", err);
  }
}

/**
 * Debrief after a run. Call via next/server after(() => schedule...) so Vercel
 * keeps the serverless isolate alive until the promise settles.
 */
export function schedulePostRunCoachFeedback(
  userId: string,
  runs: LoggedRunSummary[],
): Promise<void> {
  const filtered = runs.filter(shouldDebriefRun);
  if (!filtered.length) return Promise.resolve();
  return generatePostRunCoachFeedback(userId, filtered);
}
