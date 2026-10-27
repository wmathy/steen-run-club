/** Shared plan shapes for validation, editing, and tool persistence. */

export type PlanWorkoutDraft = {
  dayOfWeek: number;
  date?: string | null;
  type: string;
  title: string;
  description?: string | null;
  distanceMiles?: number | null;
  durationMin?: number | null;
  targetPace?: string | null;
};

export type PlanWeekDraft = {
  weekNumber: number;
  focus?: string | null;
  notes?: string | null;
  workouts: PlanWorkoutDraft[];
};

export type PlanDraft = {
  title: string;
  goal?: string | null;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  raceDate?: string | null;
  taperDays?: number | null;
  weeks: PlanWeekDraft[];
};

export type StoredWorkout = {
  id: string;
  dayOfWeek: number;
  date: string | null;
  type: string;
  title: string;
  description: string | null;
  distanceMiles: number | null;
  durationMin: number | null;
  targetPace: string | null;
  effortLevel: string | null;
  completed: boolean;
  completionStatus: string | null;
};

export type StoredWeek = {
  weekNumber: number;
  focus: string | null;
  notes: string | null;
  workouts: StoredWorkout[];
};

export type StoredPlan = {
  id: string;
  title: string;
  goal: string | null;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  raceDate: string | null;
  taperDays: number | null;
  weeks: StoredWeek[];
};

export type PlanIssue = {
  code: string;
  message: string;
};

export const RUNNING_TYPES = new Set([
  "easy",
  "recovery",
  "long",
  "tempo",
  "interval",
  "race",
  "other",
]);

export const EASY_TYPES = new Set(["easy", "recovery", "long"]);
export const QUALITY_TYPES = new Set(["tempo", "interval"]);
export const STRESS_TYPES = new Set(["tempo", "interval", "long", "race"]);
