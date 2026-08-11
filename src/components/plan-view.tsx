"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  dayName,
  formatDuration,
  formatMiles,
  formatShortDate,
  weekDateRange,
  workoutDate,
  workoutTypeLabel,
  cn,
} from "@/lib/utils";

export type CompletionStatus = "as_planned" | "modified" | null;

type Workout = {
  id: string;
  dayOfWeek: number;
  type: string;
  title: string;
  description: string | null;
  distanceMiles: number | null;
  durationMin: number | null;
  targetPace?: string | null;
  completed: boolean;
  completionStatus?: CompletionStatus;
};

type Week = {
  id: string;
  weekNumber: number;
  focus: string | null;
  notes: string | null;
  workouts: Workout[];
};

type Plan = {
  id: string;
  title: string;
  goal: string | null;
  startDate: Date | string;
  endDate: Date | string | null;
  notes: string | null;
  weeks: Week[];
};

type SelectedWorkout = {
  workout: Workout;
  weekNumber: number;
  weekFocus: string | null;
  date: Date;
};

type TimelineItem = {
  workout: Workout;
  week: Week;
  date: Date;
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
};

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
}

function localToday(): Date {
  return startOfLocalDay(new Date());
}

function completionLabel(status: CompletionStatus | undefined): string | null {
  if (status === "as_planned") return "As planned";
  if (status === "modified") return "Modified";
  return null;
}

function deviceTimeZone(): string | undefined {
  if (typeof Intl === "undefined") return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function rankType(type: string): number {
  return type === "rest" ? 2 : type === "strength" ? 1 : 0;
}

function SectionLabel({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 pt-1">
      <div
        className={cn("h-px flex-1", accent ? "bg-accent/50" : "bg-card-border")}
      />
      <span
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          accent ? "text-accent" : "text-muted",
        )}
      >
        {children}
      </span>
      <div
        className={cn("h-px flex-1", accent ? "bg-accent/50" : "bg-card-border")}
      />
    </div>
  );
}

function WorkoutCard({
  item,
  onOpen,
}: {
  item: TimelineItem;
  onOpen: () => void;
}) {
  const mark = completionLabel(item.workout.completionStatus);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition active:scale-[0.99]",
        item.isToday
          ? "border-accent bg-accent-soft ring-2 ring-accent/50 shadow-[0_0_0_1px_rgba(61,214,140,0.25)]"
          : item.isPast
            ? "border-card-border/70 bg-card/40 opacity-90 hover:border-accent/30"
            : "border-card-border bg-card/60 hover:border-accent/40",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">
          {dayName(item.workout.dayOfWeek)}{" "}
          <span className="text-muted/80">{formatShortDate(item.date)}</span>
          {item.isToday && (
            <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
              Today
            </span>
          )}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide",
            item.workout.type === "strength"
              ? "bg-accent-soft text-accent"
              : "bg-white/5 text-muted",
          )}
        >
          {workoutTypeLabel(item.workout.type)}
        </span>
      </div>
      <h3 className="text-sm font-semibold leading-snug">{item.workout.title}</h3>
      <div className="mt-1 text-xs text-muted">
        {item.workout.distanceMiles != null &&
          formatMiles(item.workout.distanceMiles)}
        {item.workout.distanceMiles != null &&
          item.workout.durationMin != null &&
          " · "}
        {item.workout.durationMin != null &&
          formatDuration(item.workout.durationMin)}
        {item.workout.targetPace && (
          <span className="block text-accent/90">{item.workout.targetPace}</span>
        )}
      </div>
      {item.workout.description && (
        <p className="mt-2 line-clamp-2 text-xs text-muted/90">
          {item.workout.description}
        </p>
      )}
      {mark ? (
        <p className="mt-2 text-[10px] font-semibold text-accent">✓ {mark}</p>
      ) : (
        <p className="mt-2 text-[10px] font-medium text-accent/80">
          Tap for details &amp; complete
        </p>
      )}
    </button>
  );
}

/**
 * Timeline order (top → bottom of the scroll list):
 *   PAST (oldest → yesterday)  ← above today; swipe/finger-down reveals (under header)
 *   TODAY                      ← docked at top of viewport on open
 *   FUTURE (tomorrow → far)    ← below today; swipe/finger-up reveals
 *
 * On phones, “scroll up” usually means swipe up (see content below);
 * “scroll down” means swipe down (see content above).
 */
export function PlanView({ plan: initialPlan }: { plan: Plan | null }) {
  const pathname = usePathname();
  const [plan, setPlan] = useState(initialPlan);
  const [selected, setSelected] = useState<SelectedWorkout | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const titleId = useId();

  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLElement>(null);
  const didAnchor = useRef(false);

  useEffect(() => {
    setPlan(initialPlan);
    didAnchor.current = false;
  }, [initialPlan]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selected]);

  const today = useMemo(() => localToday(), []);

  const timeline = useMemo((): TimelineItem[] => {
    if (!plan) return [];
    const items: TimelineItem[] = [];
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        const date = workoutDate(
          plan.startDate,
          week.weekNumber,
          workout.dayOfWeek,
        );
        const day = startOfLocalDay(date);
        const isToday = isSameLocalDay(day, today);
        const isPast = day.getTime() < today.getTime() && !isToday;
        const isFuture = day.getTime() > today.getTime();
        items.push({ workout, week, date: day, isToday, isPast, isFuture });
      }
    }
    items.sort((a, b) => {
      const t = a.date.getTime() - b.date.getTime();
      if (t !== 0) return t;
      return rankType(a.workout.type) - rankType(b.workout.type);
    });
    return items;
  }, [plan, today]);

  const todayItems = useMemo(
    () => timeline.filter((t) => t.isToday),
    [timeline],
  );

  // Oldest past at the top of the document; yesterday sits just above today
  const pastItems = useMemo(
    () => timeline.filter((t) => t.isPast),
    [timeline],
  );

  // Tomorrow first under today, then later days further down
  const futureItems = useMemo(
    () => timeline.filter((t) => t.isFuture),
    [timeline],
  );

  /**
   * Scroll the plan list so Today sits at the top of the scroll viewport.
   * Future content stays above (scroll up); past stays below (scroll down).
   */
  function anchorToday(behavior: ScrollBehavior = "auto") {
    const scroller = scrollRef.current;
    const todayEl = todayRef.current;
    if (!scroller || !todayEl) return false;

    // offsetTop relative to the scroll container's content
    const scrollerRect = scroller.getBoundingClientRect();
    const todayRect = todayEl.getBoundingClientRect();
    const delta = todayRect.top - scrollerRect.top + scroller.scrollTop;
    // Small padding so the section label isn't flush against the edge
    const top = Math.max(0, delta - 4);

    if (behavior === "smooth") {
      scroller.scrollTo({ top, behavior: "smooth" });
    } else {
      scroller.scrollTop = top;
    }
    return true;
  }

  // Anchor when opening Plan (and when plan data changes)
  useLayoutEffect(() => {
    if (pathname !== "/plan" || !plan) return;

    const run = () => {
      if (anchorToday("auto")) {
        didAnchor.current = true;
      }
    };

    run();
    const t1 = window.setTimeout(run, 50);
    const t2 = window.setTimeout(run, 200);
    const t3 = window.setTimeout(run, 400);
    // After fonts / bottom nav settle on mobile
    const t4 = window.setTimeout(run, 700);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [pathname, plan?.id, timeline.length]);

  function jumpToToday() {
    anchorToday("smooth");
  }

  function updateWorkoutLocal(
    workoutId: string,
    patch: { completed: boolean; completionStatus: CompletionStatus },
  ) {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((w) => ({
          ...w,
          workouts: w.workouts.map((wo) =>
            wo.id === workoutId ? { ...wo, ...patch } : wo,
          ),
        })),
      };
    });
    setSelected((prev) =>
      prev && prev.workout.id === workoutId
        ? { ...prev, workout: { ...prev.workout, ...patch } }
        : prev,
    );
  }

  async function setCompletion(workout: Workout, next: CompletionStatus) {
    const status: CompletionStatus =
      workout.completionStatus === next ? null : next;

    setSavingId(workout.id);
    setErrorMsg(null);
    setStatusMsg(null);

    updateWorkoutLocal(workout.id, {
      completed: status !== null,
      completionStatus: status,
    });

    try {
      const res = await fetch(`/api/plan/workouts/${workout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          timeZone: deviceTimeZone(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        coachNotified?: boolean;
        workout?: {
          completed: boolean;
          completionStatus: CompletionStatus;
        };
      };
      if (!res.ok) {
        updateWorkoutLocal(workout.id, {
          completed: workout.completed,
          completionStatus: workout.completionStatus ?? null,
        });
        setErrorMsg(data.error || "Could not update workout");
        return;
      }
      if (data.workout) {
        updateWorkoutLocal(workout.id, {
          completed: data.workout.completed,
          completionStatus: data.workout.completionStatus ?? null,
        });
      }
      if (data.coachNotified) {
        setStatusMsg(
          "Coach is reviewing this day — check the Coach tab for a reply.",
        );
      } else if (status === null) {
        setStatusMsg("Cleared completion mark.");
      }
    } catch {
      updateWorkoutLocal(workout.id, {
        completed: workout.completed,
        completionStatus: workout.completionStatus ?? null,
      });
      setErrorMsg("Network error — try again.");
    } finally {
      setSavingId(null);
    }
  }

  function openItem(item: TimelineItem) {
    setSelected({
      workout: item.workout,
      weekNumber: item.week.weekNumber,
      weekFocus: item.week.focus,
      date: item.date,
    });
  }

  if (!plan) {
    return (
      <div className="rounded-2xl border border-dashed border-card-border bg-card/40 px-6 py-14 text-center">
        <div className="mb-3 text-3xl">📅</div>
        <h2 className="mb-2 text-lg font-semibold">No active plan</h2>
        <p className="mx-auto mb-4 max-w-sm text-sm text-muted">
          Chat with your coach to build a periodized plan. When the coach saves
          it, it will show up here week by week.
        </p>
        <Link
          href="/chat"
          className="inline-flex rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black"
        >
          Open coach chat
        </Link>
      </div>
    );
  }

  const planStartLabel = formatShortDate(
    weekDateRange(plan.startDate, 1).start,
  );

  return (
    <div
      className={cn(
        // Own scrollport so anchor math works on iOS (not the window)
        "flex flex-col",
        // Fill viewport under mobile chrome / desktop main
        "h-[calc(100dvh-var(--mobile-header-h)-var(--mobile-nav-h)-var(--safe-top)-var(--safe-bottom)-0.5rem)]",
        "md:h-[calc(100dvh-2rem)]",
      )}
    >
      {/* Fixed (within this column) plan header — past content scrolls under it */}
      <header className="z-20 shrink-0 border-b border-card-border bg-background/95 pb-2 pt-0 backdrop-blur-md">
        <div className="rounded-xl border border-card-border bg-card/95 px-3 py-3 sm:px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Training plan
              </p>
              <h1 className="truncate text-base font-bold sm:text-lg">
                {plan.title}
              </h1>
              {plan.goal && (
                <p className="mt-0.5 truncate text-xs text-accent">
                  Goal: {plan.goal}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={jumpToToday}
              className="min-h-9 shrink-0 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-[11px] font-semibold text-accent"
            >
              Today
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-muted">
            Starts {planStartLabel}. Today stays under this header — swipe up
            for upcoming days, swipe down for past days.
          </p>
        </div>
      </header>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-0.5 pb-6 pt-2 [-webkit-overflow-scrolling:touch]"
      >
        {/* PAST — above today; swipe down to reveal (tucks under plan header) */}
        {pastItems.length > 0 && (
          <section id="plan-past" className="space-y-2 pb-4">
            <SectionLabel>
              Past training · {pastItems.length} session
              {pastItems.length === 1 ? "" : "s"}
            </SectionLabel>
            <p className="px-0.5 text-[11px] text-muted">
              Older days above — swipe down from today to review them.
            </p>
            {pastItems.map((item) => (
              <WorkoutCard
                key={item.workout.id}
                item={item}
                onOpen={() => openItem(item)}
              />
            ))}
          </section>
        )}

        {/* TODAY — anchored to top of this scrollport on open */}
        <section ref={todayRef} id="plan-today" className="space-y-2 pb-4">
          <SectionLabel accent>Today · {formatShortDate(today)}</SectionLabel>
          {todayItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-card-border bg-card/40 px-4 py-4 text-center text-sm text-muted">
              No workout scheduled for today.
              {pastItems.length > 0 ? " Swipe down for past days." : ""}
              {futureItems.length > 0 ? " Swipe up for upcoming days." : ""}
            </div>
          ) : (
            todayItems.map((item) => (
              <WorkoutCard
                key={item.workout.id}
                item={item}
                onOpen={() => openItem(item)}
              />
            ))
          )}
        </section>

        {/* FUTURE — below today; swipe up to reveal */}
        {futureItems.length > 0 && (
          <section className="space-y-2 pb-8">
            <SectionLabel>Upcoming</SectionLabel>
            <p className="px-0.5 text-[11px] text-muted">
              Swipe up from today for future training days.
            </p>
            {futureItems.map((item) => (
              <WorkoutCard
                key={item.workout.id}
                item={item}
                onOpen={() => openItem(item)}
              />
            ))}
          </section>
        )}

        <div className="h-4" aria-hidden />
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Week {selected.weekNumber}
                  {selected.weekFocus ? ` · ${selected.weekFocus}` : ""}
                </p>
                <h2
                  id={titleId}
                  className="mt-1 text-lg font-bold leading-snug"
                >
                  {selected.workout.title}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {dayName(selected.workout.dayOfWeek)},{" "}
                  {formatShortDate(selected.date)}
                  {isSameLocalDay(selected.date, today) && (
                    <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-black">
                      Today
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="min-h-10 shrink-0 rounded-lg px-3 text-sm text-muted hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
                {workoutTypeLabel(selected.workout.type)}
              </span>
              {selected.workout.completionStatus === "as_planned" && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-muted">
                  Completed as planned
                </span>
              )}
              {selected.workout.completionStatus === "modified" && (
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-muted">
                  Modified run
                </span>
              )}
            </div>

            <dl className="space-y-3 text-sm">
              {selected.workout.distanceMiles != null && (
                <div>
                  <dt className="text-xs text-muted">Distance</dt>
                  <dd className="font-medium">
                    {formatMiles(selected.workout.distanceMiles)}
                  </dd>
                </div>
              )}
              {selected.workout.durationMin != null && (
                <div>
                  <dt className="text-xs text-muted">Duration</dt>
                  <dd className="font-medium">
                    {formatDuration(selected.workout.durationMin)}
                  </dd>
                </div>
              )}
              {selected.workout.targetPace && (
                <div>
                  <dt className="text-xs text-muted">Suggested pace</dt>
                  <dd className="font-medium text-accent">
                    {selected.workout.targetPace}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Details</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {selected.workout.description?.trim() ||
                    "No extra notes for this day. Ask your coach if you want more structure."}
                </dd>
              </div>
            </dl>

            {selected.workout.type !== "rest" && (
              <div className="mt-6 space-y-3 rounded-xl border border-card-border bg-black/20 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  How did this day go?
                </p>
                <p className="text-xs text-muted">
                  {selected.workout.type === "strength"
                    ? "Check one option. Your coach will reply in the Coach tab about this lift session."
                    : "Check one option. We'll match your Strava/run log for this date and your coach will reply in the Coach tab."}
                </p>

                <label
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition",
                    selected.workout.completionStatus === "as_planned"
                      ? "border-accent bg-accent-soft"
                      : "border-card-border hover:border-accent/40",
                    savingId === selected.workout.id && "opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--accent,#3dd68c)]"
                    checked={
                      selected.workout.completionStatus === "as_planned"
                    }
                    disabled={savingId === selected.workout.id}
                    onChange={() =>
                      setCompletion(selected.workout, "as_planned")
                    }
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {selected.workout.type === "strength"
                        ? "Completed workout as planned"
                        : "Completed run as planned"}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      I did this workout as prescribed
                    </span>
                  </span>
                </label>

                <label
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition",
                    selected.workout.completionStatus === "modified"
                      ? "border-accent bg-accent-soft"
                      : "border-card-border hover:border-accent/40",
                    savingId === selected.workout.id && "opacity-60",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--accent,#3dd68c)]"
                    checked={
                      selected.workout.completionStatus === "modified"
                    }
                    disabled={savingId === selected.workout.id}
                    onChange={() =>
                      setCompletion(selected.workout, "modified")
                    }
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {selected.workout.type === "strength"
                        ? "Modified today's workout"
                        : "Modified today's run"}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {selected.workout.type === "strength"
                        ? "I changed exercises, sets, reps, or load"
                        : "I changed distance, pace, type, or skipped structure"}
                    </span>
                  </span>
                </label>

                {statusMsg && (
                  <p className="text-xs text-accent">{statusMsg}</p>
                )}
                {errorMsg && (
                  <p className="text-xs text-danger">{errorMsg}</p>
                )}
                {savingId === selected.workout.id && (
                  <p className="text-xs text-muted">Saving…</p>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/chat"
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-card-border text-sm font-semibold text-accent"
              >
                Open Coach
              </Link>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-accent text-sm font-semibold text-black"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
