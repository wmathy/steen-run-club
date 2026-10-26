import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APICallError } from "ai";
import {
  COACH_TEMPORARILY_UNAVAILABLE_MESSAGE,
  COACH_XAI_CREDITS_MESSAGE,
  coachErrorMessage,
  isXaiCreditsOrSpendingLimitError,
} from "@/lib/coach-errors";

const TEAM_ID = "7c8b9d0e-1234-5678-9abc-def012345678";
const API_KEY = "xai-supersecretkey";

const XAI_CREDITS_TEXT = `permission-denied: Your team ${TEAM_ID} has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.`;

function xaiCreditsError(overrides?: {
  message?: string;
  statusCode?: number;
  responseBody?: string;
}): APICallError {
  const message = overrides?.message ?? XAI_CREDITS_TEXT;
  return new APICallError({
    message,
    url: `https://api.x.ai/v1/chat/completions?key=${API_KEY}`,
    requestBodyValues: { apiKey: API_KEY, prompt: "hello" },
    statusCode: overrides?.statusCode ?? 403,
    responseHeaders: { authorization: `Bearer ${API_KEY}` },
    responseBody:
      overrides?.responseBody ??
      JSON.stringify({
        code: "permission-denied",
        error: `Your team ${TEAM_ID} has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.`,
      }),
    data: {
      code: "permission-denied",
      error: `Your team ${TEAM_ID} has either used all available credits or reached its monthly spending limit.`,
    },
  });
}

describe("xAI credits and spending-limit errors", () => {
  it("maps the HTTP 403 permission-denied credits error to the specific message", () => {
    const message = coachErrorMessage(xaiCreditsError());
    assert.equal(isXaiCreditsOrSpendingLimitError(xaiCreditsError()), true);
    assert.equal(message, COACH_XAI_CREDITS_MESSAGE);
    assert.equal(message.includes(TEAM_ID), false);
    assert.equal(message.includes(API_KEY), false);
    assert.equal(message.includes("supersecret"), false);
  });

  it("detects credits text in the response body when the message is generic", () => {
    const error = xaiCreditsError({
      message: "Forbidden",
      responseBody: JSON.stringify({
        code: "permission-denied",
        error: `Your team ${TEAM_ID} has either used all available credits or reached its monthly spending limit.`,
      }),
    });
    assert.equal(coachErrorMessage(error), COACH_XAI_CREDITS_MESSAGE);
    assert.equal(coachErrorMessage(error).includes(TEAM_ID), false);
  });

  it("maps HTTP 429 quota and billing exhaustion", () => {
    const quota = new APICallError({
      message:
        "You exceeded your current quota, please check your plan and billing details.",
      url: "https://api.x.ai/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: JSON.stringify({
        error: {
          message:
            "You exceeded your current quota, please check your plan and billing details.",
          type: "insufficient_quota",
          code: "insufficient_quota",
        },
      }),
      data: {
        error: {
          message:
            "You exceeded your current quota, please check your plan and billing details.",
          type: "insufficient_quota",
          code: "insufficient_quota",
        },
      },
    });
    assert.equal(coachErrorMessage(quota), COACH_XAI_CREDITS_MESSAGE);

    const exhausted = new Error(
      "HTTP 429 quota/billing exhaustion: monthly spending limit reached",
    );
    assert.equal(coachErrorMessage(exhausted), COACH_XAI_CREDITS_MESSAGE);
  });

  it("reads a retry wrapper's nested provider error", () => {
    const wrapped = {
      name: "AI_RetryError",
      message: "Failed after 3 attempts. Last error: rate limited",
      reason: "maxRetriesExceeded",
      errors: [xaiCreditsError({ statusCode: 429 })],
      lastError: xaiCreditsError({ statusCode: 429 }),
    };
    assert.equal(coachErrorMessage(wrapped), COACH_XAI_CREDITS_MESSAGE);
    assert.equal(coachErrorMessage(wrapped).includes(TEAM_ID), false);
  });

  it("maps the message the chat client sees from a JSON error response", () => {
    const fromCatch = new Error(
      JSON.stringify({ error: XAI_CREDITS_TEXT }),
    );
    assert.equal(coachErrorMessage(fromCatch), COACH_XAI_CREDITS_MESSAGE);
    assert.equal(coachErrorMessage(fromCatch).includes(TEAM_ID), false);

    const alreadyMapped = new Error(COACH_XAI_CREDITS_MESSAGE);
    assert.equal(coachErrorMessage(alreadyMapped), COACH_XAI_CREDITS_MESSAGE);
  });

  it("keeps the generic fallback for other failures", () => {
    const cases: unknown[] = [
      new Error("An error occurred."),
      new Error("socket hang up"),
      new Error(
        JSON.stringify({
          error: "Rate limit exceeded. Please wait before chatting again.",
        }),
      ),
      new APICallError({
        message: "permission-denied: API key does not have access to this model",
        url: "https://api.x.ai/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 403,
        responseBody: JSON.stringify({
          code: "permission-denied",
          error: "API key does not have access to this model",
        }),
      }),
      new APICallError({
        message: "resource-exhausted: Too many requests",
        url: "https://api.x.ai/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 429,
        responseBody: JSON.stringify({
          code: "resource-exhausted",
          error: "Too many requests",
        }),
      }),
      new Error("Coach is temporarily unavailable. Please try again."),
      undefined,
      null,
      "",
    ];

    for (const error of cases) {
      assert.equal(isXaiCreditsOrSpendingLimitError(error), false);
      assert.equal(
        coachErrorMessage(error),
        COACH_TEMPORARILY_UNAVAILABLE_MESSAGE,
      );
    }
  });
});
