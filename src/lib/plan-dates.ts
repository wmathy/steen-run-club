/** Calendar-date math on YYYY-MM-DD strings (UTC noon, no timezone drift). */

export function addIsoDays(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** later - earlier, in calendar days. */
export function daysBetween(earlier: string, later: string): number {
  const [y1, m1, d1] = earlier.split("-").map(Number);
  const [y2, m2, d2] = later.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

/** Monday of the week that contains isoDate. */
export function mondayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const jsDay = utc.getUTCDay(); // 0 = Sunday
  const offset = jsDay === 0 ? -6 : 1 - jsDay;
  return addIsoDays(isoDate, offset);
}

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function planDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? `day ${dayOfWeek}`;
}

/**
 * Concrete date for a plan slot.
 * Week 1 is the Monday-week that contains planStart (same as the Plan tab).
 * dayOfWeek: 0 = Monday … 6 = Sunday.
 */
export function dateForPlanSlot(
  planStart: string,
  weekNumber: number,
  dayOfWeek: number,
): string {
  const monday = mondayOf(planStart);
  return addIsoDays(monday, (weekNumber - 1) * 7 + dayOfWeek);
}

export function slotForDate(
  planStart: string,
  isoDate: string,
): { weekNumber: number; dayOfWeek: number } | null {
  const monday = mondayOf(planStart);
  const abs = daysBetween(monday, isoDate);
  if (abs < 0) return null;
  const weekNumber = Math.floor(abs / 7) + 1;
  const dayOfWeek = abs % 7;
  return { weekNumber, dayOfWeek };
}

export function absolutePlanDay(
  weekNumber: number,
  dayOfWeek: number,
): number {
  return (weekNumber - 1) * 7 + dayOfWeek;
}

export function slotFromAbsolute(abs: number): {
  weekNumber: number;
  dayOfWeek: number;
} {
  return {
    weekNumber: Math.floor(abs / 7) + 1,
    dayOfWeek: abs % 7,
  };
}
