"use client";

import { useRouter } from "next/navigation";
import { formatDuration, formatMiles, workoutTypeLabel } from "@/lib/utils";

type Run = {
  id: string;
  date: string | Date;
  distanceMiles: number;
  durationMin: number | null;
  type: string;
  notes: string | null;
  perceivedEffort: number | null;
  source?: string | null;
};

export function RunsList({ runs }: { runs: Run[] }) {
  const router = useRouter();

  async function remove(id: string) {
    if (!confirm("Delete this run?")) return;
    await fetch(`/api/runs/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-card-border bg-card/40 px-6 py-12 text-center">
        <p className="text-sm text-muted">
          No runs yet. Log one manually or tell your coach about a run in chat.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {runs.map((run) => {
        const dateStr =
          typeof run.date === "string"
            ? run.date.slice(0, 10)
            : run.date.toISOString().slice(0, 10);
        return (
          <li
            key={run.id}
            className="flex items-start justify-between gap-3 rounded-xl border border-card-border bg-card/80 px-3 py-3 sm:px-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{dateStr}</span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                  {workoutTypeLabel(run.type)}
                </span>
                {run.source === "strava" && (
                  <span className="rounded-full bg-[#fc4c02]/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#fc4c02]">
                    Strava
                  </span>
                )}
              </div>
              <div className="mt-1 text-sm text-muted">
                {formatMiles(run.distanceMiles)}
                {run.durationMin != null && (
                  <> · {formatDuration(run.durationMin)}</>
                )}
                {run.perceivedEffort != null && (
                  <> · RPE {run.perceivedEffort}</>
                )}
              </div>
              {run.notes && (
                <p className="mt-1 truncate text-xs text-muted/80">
                  {run.notes}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(run.id)}
              className="shrink-0 text-xs text-muted hover:text-danger"
            >
              Delete
            </button>
          </li>
        );
      })}
    </ul>
  );
}
