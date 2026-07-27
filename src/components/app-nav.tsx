"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AppLogo } from "@/components/app-logo";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Home", icon: "⌂" },
  { href: "/chat", label: "Coach", icon: "💬" },
  { href: "/plan", label: "Plan", icon: "📅" },
  { href: "/runs", label: "Runs", icon: "🏃" },
  { href: "/settings", label: "More", icon: "⚙" },
];

export function AppNav({
  userName,
}: {
  userName?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:border-r md:border-card-border md:bg-card/60 md:backdrop-blur-sm">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <AppLogo size={40} />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">
              Steen Run Club
            </div>
            <div className="text-xs text-muted">Coaching & training</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-muted hover:bg-white/5 hover:text-foreground",
                )}
              >
                <span className="text-base opacity-80">{link.icon}</span>
                {link.label === "More" ? "Settings" : link.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-card-border p-4">
          <div className="mb-2 truncate text-xs text-muted">
            {userName || "Athlete"}
          </div>
          <button
            type="button"
            onClick={logout}
            className="min-h-11 w-full rounded-lg border border-card-border px-3 py-2 text-sm text-muted transition hover:border-danger/40 hover:text-danger"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar — safe area for notch */}
      <header
        className="sticky top-0 z-30 flex items-center justify-between border-b border-card-border bg-background/95 px-3 backdrop-blur-md md:hidden"
        style={{
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          minHeight: "calc(var(--mobile-header-h) + env(safe-area-inset-top))",
        }}
      >
        <div className="flex min-w-0 items-center gap-2 py-2">
          <AppLogo size={30} />
          <span className="truncate text-sm font-semibold tracking-tight">
            Steen Run Club
          </span>
        </div>
        <button
          type="button"
          onClick={logout}
          className="min-h-11 shrink-0 rounded-lg px-3 py-2 text-sm text-muted active:bg-white/5"
        >
          Sign out
        </button>
      </header>

      {/* Mobile bottom nav — thumb-friendly targets + home indicator */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-card-border bg-card/95 backdrop-blur-md md:hidden"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <div className="mx-auto flex h-[var(--mobile-nav-h)] max-w-lg items-stretch justify-around">
          {links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium active:opacity-80",
                  active ? "text-accent" : "text-muted",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-10 items-center justify-center rounded-full text-lg leading-none",
                    active && "bg-accent-soft",
                  )}
                >
                  {link.icon}
                </span>
                <span className="truncate">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
