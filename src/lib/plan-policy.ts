/**
 * When the coach is allowed to write the stored plan.
 * Missed work may be suggested; it must not overwrite the plan without a yes.
 */

export type PlanWriteReason =
  | "new_plan"
  | "athlete_requested"
  | "schedule_edit"
  | "agreed_makeup"
  | "recovery_adjustment";

export const PLAN_WRITE_REASONS = [
  "new_plan",
  "athlete_requested",
  "schedule_edit",
  "agreed_makeup",
  "recovery_adjustment",
] as const satisfies readonly PlanWriteReason[];

/** Missing, null, or unknown reasons must not fail schema validation. */
export function coercePlanWriteReason(
  value: string | null | undefined,
  fallback: PlanWriteReason,
): PlanWriteReason {
  if (
    value &&
    (PLAN_WRITE_REASONS as readonly string[]).includes(value)
  ) {
    return value as PlanWriteReason;
  }
  return fallback;
}

export type PlanWriteMode = "interactive" | "automatic";

const MISSED_PATTERNS = [
  /\bmissed\b[^.]{0,48}\b(run|runs|workout|workouts|session|sessions|miles|mile|training|long)\b/i,
  /\bskipped\b[^.]{0,48}\b(run|runs|workout|workouts|session|sessions|miles|mile|training|day|it)\b/i,
  /\b(didn't|did not|couldn't|could not|forgot to)\b[^.]{0,48}\b(run|workout|train)\b/i,
  /\bfell behind\b/i,
  /\bmissed miles\b/i,
  /\bno miles\b/i,
];

const SCHEDULE_PATTERNS = [
  /\b(move|shift|swap|switch|reschedule)\b/i,
  /\bpush back\b/i,
  /\bslide\b/i,
];

const CONSENT_PATTERNS = [
  /^(yes|yeah|yep|yup|please do|do it|go ahead)\b/i,
  /\b(yes|yeah|yep|yup),?\s+(please|update|add|change|do|go)\b/i,
  /\bgo ahead\b/i,
  /\bdo it\b/i,
  /\bsounds good\b/i,
  /\bi agree\b/i,
  /\bplease\b[^.]{0,48}\b(update|change|add|move|swap|shift)\b/i,
  /\b(update|change) (the|my) plan\b/i,
  /\badd (a |the )?(short |easy )?(make-?up|missed miles|those miles|the miles)\b/i,
  /\blet's (update|add|move|change|do|put)\b/i,
  /\bok(?:ay)?,?\s+(please|update|add|change|do|go)\b/i,
];

export function reportsMissedWork(text: string): boolean {
  return MISSED_PATTERNS.some((pattern) => pattern.test(text));
}

export function requestsScheduleEdit(text: string): boolean {
  return SCHEDULE_PATTERNS.some((pattern) => pattern.test(text));
}

export function givesPlanConsent(text: string): boolean {
  return CONSENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function assessPlanWrite(input: {
  mode: PlanWriteMode;
  userText: string | null;
  reason: PlanWriteReason;
}): { ok: true } | { ok: false; message: string } {
  if (input.mode === "automatic") {
    if (input.reason === "agreed_makeup") {
      return {
        ok: false,
        message:
          "Do not change the stored plan to make up missed miles from an automatic check-in. Suggest an optional make-up in your message and wait until the athlete agrees in chat.",
      };
    }
    return { ok: true };
  }

  const text = input.userText ?? "";
  const missed = reportsMissedWork(text);
  const schedule = requestsScheduleEdit(text);
  const consent = givesPlanConsent(text);

  if (missed && !schedule && !consent) {
    return {
      ok: false,
      message:
        "The athlete reported missed miles or a missed workout and has not agreed to change the plan. Suggest an optional make-up in your reply if it would help. Do not demand it, and do not change the stored plan until they clearly say yes.",
    };
  }

  if (input.reason === "agreed_makeup" && !consent) {
    return {
      ok: false,
      message:
        "A make-up change needs a clear yes from the athlete first. Offer it as optional, then wait.",
    };
  }

  return { ok: true };
}
