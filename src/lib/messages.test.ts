import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";

process.env.DATABASE_URL ??=
  "postgresql://steen:steen@127.0.0.1:5432/steen_test?sslmode=disable";

function textMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

describe("loadChatMessages", () => {
  it("drops empty assistant rows and strips old tool parts before the model sees them", async () => {
    const { convertToModelMessages } = await import("ai");
    const { projectStoredChatMessages } = await import("@/lib/messages");

    const blob = `PLAN_TOOL_BLOB_${"x".repeat(50_000)}`;
    const messages = projectStoredChatMessages([
      {
        id: "u1",
        role: "user",
        content: "Build the 10-week plan",
        partsJson: JSON.stringify([
          { type: "text", text: "Build the 10-week plan" },
          { type: "tool-save_or_update_plan", input: { blob } },
        ]),
      },
      {
        id: "a-broken",
        role: "assistant",
        content: "",
        partsJson: JSON.stringify([
          { type: "step-start" },
          {
            type: "tool-save_or_update_plan",
            toolCallId: "call-bad",
            state: "output-error",
            input: { weeks: [{ blob }] },
            errorText: "AI_InvalidToolInputError",
          },
          {
            type: "tool-save_or_update_plan",
            toolCallId: "call-dangling",
            state: "input-available",
            input: { title: "Block", blob },
          },
        ]),
      },
      {
        id: "a-blank",
        role: "assistant",
        content: "   \n",
        partsJson: JSON.stringify([{ type: "text", text: "should not load" }]),
      },
      {
        id: "a-ok",
        role: "assistant",
        content: "Your plan is ready.",
        partsJson: JSON.stringify([
          { type: "text", text: "Your plan is ready." },
          {
            type: "tool-save_or_update_plan",
            state: "output-available",
            input: { blob },
            output: { success: true },
          },
        ]),
      },
    ]);

    assert.deepEqual(
      messages.map((message) => message.id),
      ["u1", "a-ok"],
    );
    assert.deepEqual(messages[1]?.parts, [
      { type: "text", text: "Your plan is ready." },
    ]);
    assert.equal(
      messages.every((message) =>
        message.parts.every((part) => part.type === "text"),
      ),
      true,
    );

    const modelMessages = await convertToModelMessages(messages);
    const serialized = JSON.stringify(modelMessages);
    assert.equal(serialized.includes("PLAN_TOOL_BLOB_"), false);
    assert.equal(serialized.includes("AI_InvalidToolInputError"), false);
    assert.equal(serialized.includes("tool-save_or_update_plan"), false);
    assert.equal(serialized.includes("Your plan is ready."), true);
    assert.equal(serialized.includes("Build the 10-week plan"), true);
  });
});

describe("appendChatTurn / onEnd", () => {
  it("synthesizes coaching text when a plan or run tool succeeded without model text", async () => {
    const {
      messagesForAppend,
      COACH_PLAN_SAVED_TEXT,
      COACH_RUN_SAVED_TEXT,
      COACH_SCHEDULE_UPDATED_TEXT,
    } = await import("@/lib/messages");

    const planTurn = messagesForAppend(
      [
        textMessage("u1", "user", "Build the 10-week plan"),
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "tool-save_or_update_plan",
              toolCallId: "call-plan",
              state: "output-available",
              input: { title: "Block", weeks: [] },
              output: { success: true, planId: "p1" },
            },
          ] as UIMessage["parts"],
        },
      ],
      { hadStreamError: false },
    );
    assert.equal(planTurn.length, 2);
    assert.deepEqual(planTurn[1]?.parts, [
      { type: "text", text: COACH_PLAN_SAVED_TEXT, state: "done" },
    ]);
    assert.equal(
      JSON.stringify(planTurn).includes("tool-save_or_update_plan"),
      false,
    );

    const runTurn = messagesForAppend([
      textMessage("u2", "user", "I ran 6 miles"),
      {
        id: "a2",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "save_run",
            toolCallId: "call-run",
            state: "output-available",
            input: { distanceMiles: 6 },
            output: { success: true, runId: "r1" },
          },
        ] as UIMessage["parts"],
      },
    ]);
    assert.equal(runTurn[1]?.parts[0]?.type, "text");
    assert.equal(
      runTurn[1]?.parts[0] && "text" in runTurn[1].parts[0]
        ? runTurn[1].parts[0].text
        : "",
      COACH_RUN_SAVED_TEXT,
    );

    const editTurn = messagesForAppend([
      textMessage("u3", "user", "Move Thursday"),
      {
        id: "a3",
        role: "assistant",
        parts: [
          {
            type: "tool-edit_plan_schedule",
            toolCallId: "call-edit",
            state: "output-available",
            input: { operations: [] },
            output: { success: true },
          },
        ] as UIMessage["parts"],
      },
    ]);
    assert.equal(
      editTurn[1]?.parts[0] && "text" in editTurn[1].parts[0]
        ? editTurn[1].parts[0].text
        : "",
      COACH_SCHEDULE_UPDATED_TEXT,
    );
  });

  it("still saves fallback text when the stream errored after a successful plan write", async () => {
    const { messagesForAppend, COACH_PLAN_SAVED_TEXT } = await import(
      "@/lib/messages"
    );
    const saved = messagesForAppend(
      [
        textMessage("u1", "user", "Build the plan"),
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-save_or_update_plan",
              toolCallId: "call-plan",
              state: "output-available",
              input: { title: "Block" },
              output: { success: true },
            },
          ] as UIMessage["parts"],
        },
      ],
      { hadStreamError: true },
    );
    assert.equal(saved[1]?.role, "assistant");
    assert.equal(
      saved[1]?.parts[0] && "text" in saved[1].parts[0]
        ? saved[1].parts[0].text
        : "",
      COACH_PLAN_SAVED_TEXT,
    );
  });

  it("skips empty failed assistant turns when the stream errored", async () => {
    const { messagesForAppend } = await import("@/lib/messages");
    const saved = messagesForAppend(
      [
        textMessage("u1", "user", "Build the 10-week plan"),
        {
          id: "a-broken",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "tool-save_or_update_plan",
              toolCallId: "call-bad",
              state: "output-error",
              input: { weeks: [] },
              errorText: "AI_InvalidToolInputError",
            },
            {
              type: "tool-save_or_update_plan",
              toolCallId: "call-dangling",
              state: "input-available",
              input: { title: "Block" },
            },
          ] as UIMessage["parts"],
        },
      ],
      { hadStreamError: true },
    );
    assert.deepEqual(
      saved.map((message) => message.role),
      ["user"],
    );
    assert.equal(JSON.stringify(saved).includes("AI_InvalidToolInputError"), false);

    const withoutStreamError = messagesForAppend(
      [
        textMessage("u2", "user", "Build the 10-week plan"),
        {
          id: "a-broken-2",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "tool-save_or_update_plan",
              toolCallId: "call-bad",
              state: "output-error",
              errorText: "AI_InvalidToolInputError",
            },
          ] as UIMessage["parts"],
        },
      ],
      { hadStreamError: false },
    );
    assert.deepEqual(
      withoutStreamError.map((message) => message.id),
      ["u2"],
    );
  });

  it("keeps model text and drops the tool payload on a normal reply", async () => {
    const { messagesForAppend } = await import("@/lib/messages");
    const saved = messagesForAppend([
      textMessage("u1", "user", "Move Thursday"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Thursday is now easy." },
          {
            type: "tool-edit_plan_schedule",
            toolCallId: "call-edit",
            state: "output-available",
            input: { blob: "PLAN_TOOL_BLOB" },
            output: { success: true },
          },
        ] as UIMessage["parts"],
      },
    ]);
    assert.deepEqual(saved[1]?.parts, [
      { type: "text", text: "Thursday is now easy." },
    ]);
  });
});
