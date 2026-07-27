export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatMiles(miles: number): string {
  return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
}

export function formatDuration(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m} min`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function dayName(dayOfWeek: number): string {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dayOfWeek] ?? "?";
}

export function workoutTypeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Parse plan start date as local calendar date (noon to avoid TZ edge cases). */
export function parsePlanDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      12,
      0,
      0,
    );
  }
  const s = value.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Week 1 Mon–Sun starts at plan.startDate; week N is +7*(N-1) days. */
export function weekDateRange(
  planStart: Date | string,
  weekNumber: number,
): { start: Date; end: Date } {
  const start = parsePlanDate(planStart);
  start.setDate(start.getDate() + (weekNumber - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

/** Concrete date for a workout: plan start + (week-1)*7 + dayOfWeek (0=Mon). */
export function workoutDate(
  planStart: Date | string,
  weekNumber: number,
  dayOfWeek: number,
): Date {
  const d = parsePlanDate(planStart);
  d.setDate(d.getDate() + (weekNumber - 1) * 7 + dayOfWeek);
  return d;
}

/** e.g. "Mar 3" or "Mar 3 – Mar 9, 2026" */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatWeekRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endStr = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
}
