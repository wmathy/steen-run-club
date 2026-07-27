"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppLogo } from "@/components/app-logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        mode === "login" ? "/api/auth/login" : "/api/auth/signup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "login"
              ? { email, password }
              : { email, password, name },
          ),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      router.push("/dashboard");
      router.refresh();
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
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === "login" ? "Welcome back" : "Join Steen Run Club"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {mode === "login"
            ? "Sign in to Steen Run Club."
            : "Create an account — your coach, plans, and runs stay private."}
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-2xl border border-card-border bg-card/80 p-6 shadow-xl shadow-black/20"
      >
        {mode === "signup" && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-12 w-full rounded-lg border border-card-border bg-input-bg px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent/40"
              placeholder="Alex"
              autoComplete="name"
            />
          </label>
        )}

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

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">
            Password
          </span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-card-border bg-input-bg px-3 py-3 text-base outline-none focus:ring-2 focus:ring-accent/40"
            placeholder="Min. 8 characters"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
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
          {loading
            ? "Please wait…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            No account?{" "}
            <Link href="/signup" className="text-accent hover:underline">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
