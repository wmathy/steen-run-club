/**
 * User-facing copy when the coach cannot complete an AI call.
 *
 * Credit and spending-limit failures from xAI get a specific message.
 * Every other failure stays on the generic unavailable line.
 * Callers always receive one of those two strings, so team ids, request
 * bodies, and API keys from the upstream error never reach the UI.
 */

export const COACH_TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Coach is temporarily unavailable. Please try again in a moment.";

export const COACH_XAI_CREDITS_MESSAGE =
  "Coach is paused because the xAI API account is out of credits or reached its monthly spending limit. Top up credits or raise the limit in console.x.ai to continue.";

const CREDIT_OR_SPENDING_PATTERNS: readonly RegExp[] = [
  /used all available credits/i,
  /\bout of credits\b/i,
  /\bno remaining credits\b/i,
  /\bcredits exhausted\b/i,
  /\bcredit balance\b/i,
  /monthly spending limit/i,
  /\bspending limit\b/i,
  /purchase more credits/i,
  /raise (?:your |the )?spending limit/i,
  /insufficient[_\s-]?quota/i,
  /exceeded your current quota/i,
  /check your plan and billing/i,
  /billing hard limit/i,
];

const MAX_ERROR_DEPTH = 6;

/**
 * True when an upstream AI error is xAI (or a similar provider) reporting
 * that credits are gone or a monthly spending / billing quota is exhausted.
 * Plain rate limits are not included.
 */
export function isXaiCreditsOrSpendingLimitError(error: unknown): boolean {
  const text = collectErrorText(error);
  if (!text) return false;
  if (text.includes(COACH_XAI_CREDITS_MESSAGE)) return true;
  if (CREDIT_OR_SPENDING_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return isQuotaBillingExhaustion(text);
}

/** Map any coach/AI failure to the red-banner string. */
export function coachErrorMessage(error: unknown): string {
  return isXaiCreditsOrSpendingLimitError(error)
    ? COACH_XAI_CREDITS_MESSAGE
    : COACH_TEMPORARILY_UNAVAILABLE_MESSAGE;
}

function isQuotaBillingExhaustion(text: string): boolean {
  const quota = /\bquota\b/i.test(text);
  const billing = /\bbilling\b/i.test(text);
  const credits = /\bcredits?\b/i.test(text);
  const exhausted = /\bexhaust(?:ed|ion)\b/i.test(text);
  if (exhausted && (quota || billing || credits)) return true;
  if (billing && (quota || credits)) return true;
  return false;
}

/**
 * Text we are willing to inspect. Skips request bodies, URLs, and headers,
 * which can carry secrets that are irrelevant to this classification.
 */
function collectErrorText(
  error: unknown,
  depth = 0,
  seen: Set<unknown> = new Set(),
): string {
  if (error == null || depth > MAX_ERROR_DEPTH) return "";
  if (typeof error === "string") {
    const parsed = parseJsonContainer(error);
    return parsed == null
      ? error
      : `${error}\n${collectErrorText(parsed, depth + 1, seen)}`;
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  if (typeof error !== "object") return "";
  if (seen.has(error)) return "";
  seen.add(error);

  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of [
    "message",
    "statusCode",
    "responseBody",
    "code",
    "type",
    "reason",
  ] as const) {
    if (key in record) parts.push(collectErrorText(record[key], depth + 1, seen));
  }
  for (const key of ["data", "cause", "error", "lastError"] as const) {
    if (key in record) parts.push(collectErrorText(record[key], depth + 1, seen));
  }
  if (Array.isArray(record.errors)) {
    for (const nested of record.errors) {
      parts.push(collectErrorText(nested, depth + 1, seen));
    }
  }
  return parts.filter(Boolean).join("\n");
}

function parseJsonContainer(value: string): unknown | null {
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}
