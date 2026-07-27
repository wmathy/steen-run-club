"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const RUN_TYPES = [
  "easy",
  "tempo",
  "interval",
  "long",
  "race",
  "recovery",
  "other",
] as const;

export function RunForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    distanceMiles: "",
    durationMin: "",
    type: "easy",
    notes: "",
    perceivedEffort: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          distanceMiles: Number(form.distanceMiles),
          durationMin: form.durationMin
            ? Number(form.durationMin)
            : undefined,
          type: form.type,
          notes: form.notes || undefined,
          perceivedEffort: form.perceivedEffort
            ? Number(form.perceivedEffort)
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save run");
        return;
      }
      setOpen(false);
      setForm((f) => ({
        ...f,
        distanceMiles: "",
        durationMin: "",
        notes: "",
        perceivedEffort: "",
      }));
      onCreated?.();
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-black hover:bg-accent/90 sm:min-h-0 sm:w-auto sm:py-2.5"
      >
        + Log run
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-2xl border border-card-border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Log a run</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Date</span>
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Type</span>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          >
            {RUN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Distance (miles)</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            required
            value={form.distanceMiles}
            onChange={(e) =>
              setForm({ ...form, distanceMiles: e.target.value })
            }
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Duration (min)</span>
          <input
            type="number"
            inputMode="numeric"
            step="1"
            min="1"
            value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Perceived effort (1–10)</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="10"
            value={form.perceivedEffort}
            onChange={(e) =>
              setForm({ ...form, perceivedEffort: e.target.value })
            }
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          />
        </label>
        <label className="block text-xs sm:col-span-2">
          <span className="mb-1 block text-muted">Notes</span>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
            placeholder="Felt strong on the last mile…"
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="min-h-12 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-black disabled:opacity-60 sm:w-auto sm:min-h-0 sm:py-2"
      >
        {loading ? "Saving…" : "Save run"}
      </button>
    </form>
  );
}
