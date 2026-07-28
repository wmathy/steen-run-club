"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AppLogo } from "@/components/app-logo";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (!token) {
      setError("This reset link is missing or invalid. Request a new one.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not reset password");
        return;
      }
      router.push("/login?reset=1");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto w-full max-w-md text-center">
        <div className="mb-4 flex justify-center">
          <AppLogo size={72} priority />
        </div>
        <h1 className="text-xl font-bold">Invalid reset link</h1>
        <p className="mt-2 text-sm text-muted">
          This link is incomplete. Request a new password reset.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex text-sm font-medium text-accent hover:underline"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <AppLogo size={72} priority />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Set new password</h1>
        <p className="mt-2 text-sm text-muted">
          Choose a new password (at least 8 characters).
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-2xl border border-card-border bg-card/80 p-6 shadow-xl shadow-black/20"
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">
            New password
          </span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-card-border bg-input-bg px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent/40"
            autoComplete="new-password"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">
            Confirm password
          </span>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-card-border bg-input-bg px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent/40"
            autoComplete="new-password"
          />
        </label>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="min-h-12 w-full rounded-lg bg-accent py-3 text-sm font-semibold text-black transition hover:bg-accent/90 disabled:opacity-60"
        >
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
