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

/** dayOfWeek in plans: 0=Monday … 6=Sunday */
export function dayName(dayOfWeek: number): string {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dayOfWeek] ?? "?";
}

export function workoutTypeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Parse a calendar date (YYYY-MM-DD or Date) into a local noon Date.
 * For Date values from Postgres/Prisma (often midnight or noon UTC), use
 * UTC Y/M/D so US timezones don't shift the calendar day back one day.
 */
export function parsePlanDate(value: Date | string): Date {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = value.getUTCMonth();
    const d = value.getUTCDate();
    return new Date(y, m, d, 12, 0, 0);
  }
  const s = value.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Monday (local) of the week containing `date`.
 * JS getDay(): 0=Sun … 6=Sat → plan dayOfWeek 0=Mon … 6=Sun.
 */
export function startOfWeekMonday(date: Date | string): Date {
  const d = parsePlanDate(date);
  const jsDay = d.getDay(); // 0=Sun … 6=Sat
  const offsetToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + offsetToMonday);
  return d;
}

/**
 * Week N Mon–Sun. Week 1 is the Monday-week that contains plan.startDate
 * (so day names always match real calendar dates).
 */
export function weekDateRange(
  planStart: Date | string,
  weekNumber: number,
): { start: Date; end: Date } {
  const start = startOfWeekMonday(planStart);
  start.setDate(start.getDate() + (weekNumber - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

/**
 * Concrete date for a workout.
 * dayOfWeek: 0=Monday … 6=Sunday, relative to the Monday of plan week N.
 */
export function workoutDate(
  planStart: Date | string,
  weekNumber: number,
  dayOfWeek: number,
): Date {
  const d = startOfWeekMonday(planStart);
  const dow = Math.min(6, Math.max(0, Math.floor(dayOfWeek)));
  d.setDate(d.getDate() + (weekNumber - 1) * 7 + dow);
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
