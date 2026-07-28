"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  COACHING_STYLE_OPTIONS,
  normalizeCoachingStyle,
  type CoachingStyle,
} from "@/lib/coach-prompt";
import { cn } from "@/lib/utils";

type Profile = {
  summary: string;
  goals: string;
  injuries: string;
  preferences: string;
  raceCalendar: string;
  fitnessLevel: string;
  schedule: string;
  coachingStyle?: string | null;
} | null;

/** Stable date string (avoids Node vs browser locale mismatches). */
function formatSyncTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  let hour = d.getHours();
  const minute = d.getMinutes().toString().padStart(2, "0");
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${month} ${day}, ${year}, ${hour}:${minute} ${ampm}`;
}

export function SettingsClient({
  profile,
  stravaConnected,
  stravaConfigured,
  stravaLastSyncedAt,
  userEmail,
  userName,
}: {
  profile: Profile;
  stravaConnected: boolean;
  stravaConfigured: boolean;
  stravaLastSyncedAt?: string | null;
  userEmail: string;
  userName?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stravaStatus = searchParams.get("strava");
  const [saving, setSaving] = useState(false);
  const [syncingStrava, setSyncingStrava] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    goals: profile?.goals ?? "",
    injuries: profile?.injuries ?? "",
    preferences: profile?.preferences ?? "",
    raceCalendar: profile?.raceCalendar ?? "",
    fitnessLevel: profile?.fitnessLevel ?? "",
    schedule: profile?.schedule ?? "",
    summary: profile?.summary ?? "",
  });
  const [coachingStyle, setCoachingStyle] = useState<CoachingStyle>(
    normalizeCoachingStyle(profile?.coachingStyle),
  );
  const [savingStyle, setSavingStyle] = useState(false);
  const [pwForm, setPwForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [savingPw, setSavingPw] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        setMessage("Failed to save profile");
        return;
      }
      setMessage("Profile saved");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveCoachingStyle(style: CoachingStyle) {
    setCoachingStyle(style);
    setSavingStyle(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coachingStyle: style }),
      });
      if (!res.ok) {
        setMessage("Failed to save coaching style");
        return;
      }
      const styleLabels: Record<CoachingStyle, string> = {
        concise: "Coaching style: Concise — short, focused replies.",
        balanced:
          "Coaching style: Balanced — clear replies with useful context.",
        detailed:
          "Coaching style: Detailed — fuller explanations and rationale.",
        motivational:
          "Coaching style: Motivational — finish the run, keep showing up.",
        goggins:
          "Coaching style: Goggins Mode — stay hard. Direct, raw, no excuses.",
      };
      setMessage(styleLabels[style]);
      router.refresh();
    } finally {
      setSavingStyle(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setMessage("New passwords do not match");
      return;
    }
    setSavingPw(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: pwForm.currentPassword,
          newPassword: pwForm.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Could not update password");
        return;
      }
      setPwForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setMessage("Password updated successfully.");
    } catch {
      setMessage("Network error");
    } finally {
      setSavingPw(false);
    }
  }

  async function connectStrava() {
    const res = await fetch("/api/strava/connect");
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      setMessage(data.error || "Strava not available");
    }
  }

  async function disconnectStrava() {
    if (!confirm("Disconnect Strava? Existing imported runs stay in your log.")) {
      return;
    }
    await fetch("/api/strava/disconnect", { method: "POST" });
    router.refresh();
  }

  async function syncStrava() {
    setMessage(null);
    setSyncingStrava(true);
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Strava sync failed");
        return;
      }
      setMessage(
        `Strava sync: ${data.created} new, ${data.updated} updated, ${data.skipped} skipped (non-runs).`,
      );
      router.refresh();
    } finally {
      setSyncingStrava(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as {userName || userEmail}
        </p>
      </div>

      {stravaStatus === "connected" && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          Strava connected. Recent runs were imported — your coach can use them.
        </div>
      )}
      {stravaStatus === "error" && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          Strava connection failed. Try again.
        </div>
      )}
      {stravaStatus === "scope" && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          Strava needs activity access. Reconnect and allow activity permissions.
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-card-border bg-card/80 p-5">
        <h2 className="mb-1 text-sm font-semibold">Strava</h2>
        <p className="mb-4 text-xs text-muted">
          Connect Strava to auto-import runs into your log. Connect COROS →
          Strava in the COROS app first if you use a COROS watch. New runs appear
          in the run log and as notes in coach chat so coaching stays current.
        </p>
        {!stravaConfigured ? (
          <div className="rounded-lg border border-dashed border-card-border bg-input-bg/50 p-4 text-sm text-muted">
            <p className="font-medium text-foreground/80">Setup required</p>
            <p className="mt-1 text-xs">
              Create an app at{" "}
              <a
                href="https://www.strava.com/settings/api"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline"
              >
                strava.com/settings/api
              </a>
              , then set <code className="text-accent">STRAVA_CLIENT_ID</code>{" "}
              and <code className="text-accent">STRAVA_CLIENT_SECRET</code> in{" "}
              <code>.env</code>. Authorization callback:{" "}
              <code className="text-accent">
                http://localhost:3000/api/strava/callback
              </code>
            </p>
          </div>
        ) : stravaConnected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                Connected
              </span>
              {stravaLastSyncedAt && (
                <span className="text-[11px] text-muted" suppressHydrationWarning>
                  Last sync {formatSyncTime(stravaLastSyncedAt)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={syncStrava}
                disabled={syncingStrava}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs hover:border-accent/40 disabled:opacity-60"
              >
                {syncingStrava ? "Syncing…" : "Sync now"}
              </button>
              <button
                type="button"
                onClick={disconnectStrava}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:text-danger"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={connectStrava}
            className="rounded-lg bg-[#fc4c02] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e34402]"
          >
            Connect Strava
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-card-border bg-card/80 p-5">
        <h2 className="mb-1 text-sm font-semibold">Coaching style</h2>
        <p className="mb-4 text-xs text-muted">
          How the coach writes in chat. Applies to new messages (you can change
          this anytime).
        </p>
        <div className="grid gap-2">
          {COACHING_STYLE_OPTIONS.map((opt) => {
            const selected = coachingStyle === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={savingStyle}
                onClick={() => saveCoachingStyle(opt.id)}
                className={cn(
                  "min-h-14 rounded-xl border px-3 py-3 text-left transition active:scale-[0.99] sm:min-h-0",
                  selected
                    ? "border-accent bg-accent-soft ring-1 ring-accent/40"
                    : "border-card-border bg-input-bg/40 hover:border-accent/30",
                  savingStyle && "opacity-70",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{opt.label}</span>
                  {selected && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-accent">
                      Active
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-muted">
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <form
        onSubmit={saveProfile}
        className="space-y-3 rounded-2xl border border-card-border bg-card/80 p-5"
      >
        <h2 className="text-sm font-semibold">Coach profile (memory)</h2>
        <p className="text-xs text-muted">
          Injected into the coach system prompt. The coach also updates this via
          tools during chat.
        </p>

        {(
          [
            ["summary", "Summary"],
            ["fitnessLevel", "Fitness level"],
            ["goals", "Goals"],
            ["injuries", "Injuries / limitations"],
            ["schedule", "Weekly schedule"],
            ["preferences", "Preferences"],
            ["raceCalendar", "Race calendar"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block text-xs">
            <span className="mb-1 block text-muted">{label}</span>
            <textarea
              rows={key === "summary" ? 3 : 2}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              className="w-full rounded-lg border border-card-border bg-input-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
            />
          </label>
        ))}

        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      <form
        onSubmit={changePassword}
        className="space-y-3 rounded-2xl border border-card-border bg-card/80 p-5"
      >
        <h2 className="text-sm font-semibold">Change password</h2>
        <p className="text-xs text-muted">
          Update your password while signed in. For a lost password, sign out
          and use{" "}
          <a href="/forgot-password" className="text-accent hover:underline">
            Forgot password
          </a>
          .
        </p>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Current password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={pwForm.currentPassword}
            onChange={(e) =>
              setPwForm({ ...pwForm, currentPassword: e.target.value })
            }
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">New password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={pwForm.newPassword}
            onChange={(e) =>
              setPwForm({ ...pwForm, newPassword: e.target.value })
            }
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block text-muted">Confirm new password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={pwForm.confirmPassword}
            onChange={(e) =>
              setPwForm({ ...pwForm, confirmPassword: e.target.value })
            }
            className="min-h-11 w-full rounded-lg border border-card-border bg-input-bg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-accent/40 sm:text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={savingPw}
          className="min-h-11 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-60"
        >
          {savingPw ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
