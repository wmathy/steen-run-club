"use client";

import Link from "next/link";
import { useState } from "react";
import { AppLogo } from "@/components/app-logo";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <AppLogo size={72} priority />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Forgot password</h1>
        <p className="mt-2 text-sm text-muted">
          Enter your account email and we’ll send a reset link if it exists.
        </p>
      </div>

      {done ? (
        <div className="space-y-4 rounded-2xl border border-card-border bg-card/80 p-6">
          <p className="text-sm text-foreground">
            If an account exists for that email, you’ll receive a reset link
            shortly. Check your inbox and spam folder.
          </p>
          <p className="text-xs text-muted">
            The link expires in 1 hour. You can request another one if needed.
          </p>
          <Link
            href="/login"
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-accent py-3 text-sm font-semibold text-black"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-card-border bg-card/80 p-6 shadow-xl shadow-black/20"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">
              Email
            </span>
            <input
              type="email"
              required
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-12 w-full rounded-lg border border-card-border bg-input-bg px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="you@example.com"
              autoComplete="email"
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
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
