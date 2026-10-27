import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import { CoachMessageList } from "@/components/coach-message-list";
import {
  coachingTextFromMessage,
  coachTranscriptStatus,
  isCoachReplyPending,
  isCoachTurnBusy,
  messagesToDisplay,
} from "@/lib/coach-message-display";

const FULL_REPLY =
  "Updating Thursday to easy.\n\nDone — Thursday is an easy 4 miles.";
const PARTIAL = "Updating Thursday";
const TOOL_PAYLOAD = "plan-payload-xyz";
const REASONING = "INTERNAL: drop the long run before telling them";

function textPart(
  text: string,
  state?: "streaming" | "done",
): UIMessage["parts"][number] {
  return state ? { type: "text", text, state } : { type: "text", text };
}

function message(
  id: string,
  role: "user" | "assistant",
  parts: UIMessage["parts"],
): UIMessage {
  return { id, role, parts };
}

function user(id: string, text: string): UIMessage {
  return message(id, "user", [textPart(text)]);
}

function assistant(
  id: string,
  text: string,
  state?: "streaming" | "done",
): UIMessage {
  return message(id, "assistant", [textPart(text, state)]);
}

const history = [
  user("u-hi", "Hi"),
  assistant("a-welcome", "Welcome — want a plan?"),
];

function openTurn(partial: string): UIMessage[] {
  return [
    ...history,
    user("u-move", "Move Thursday's workout"),
    assistant("a-live", partial, "streaming"),
  ];
}

function visibleText(messages: readonly UIMessage[], status: string): string[] {
  return messagesToDisplay(messages, status)
    .map(coachingTextFromMessage)
    .filter((text) => text.length > 0);
}

describe("coach reply appears all at once", () => {
  it("keeps the composer busy and Coach thinking while recovery is still polling", () => {
    assert.equal(isCoachTurnBusy("error", true), true);
    assert.equal(isCoachTurnBusy("ready", true), true);
    assert.equal(isCoachTurnBusy("error", false), false);
    assert.equal(isCoachTurnBusy("streaming", false), true);
    const status = coachTranscriptStatus("error", { checkingSavedReply: true });
    assert.equal(status, "streaming");
    assert.equal(isCoachReplyPending(status), true);
    const html = renderToStaticMarkup(
      <CoachMessageList
        messages={[user("u-recover", "Lengthen the weekend runs")]}
        status={status}
      />,
    );
    assert.match(html, /aria-label="Coach is thinking"/);
    assert.equal(
      coachTranscriptStatus("error", {
        checkingSavedReply: true,
        streamRecovered: true,
      }),
      "ready",
    );
  });

  it("hides every partial snapshot while Coach is thinking or streaming", () => {
    const prompts = [
      "submitted" as const,
      "streaming" as const,
    ];
    const snapshots = ["U", "Up", PARTIAL, "Updating Thursday to easy."];

    for (const status of prompts) {
      assert.equal(isCoachReplyPending(status), true);
      for (const partial of snapshots) {
        const texts = visibleText(openTurn(partial), status);
        assert.deepEqual(texts, ["Hi", "Welcome — want a plan?", "Move Thursday's workout"]);
        assert.equal(texts.some((text) => text.includes(partial)), false);
      }
    }
  });

  it("keeps the typing state up with no assistant bubble before the first token", () => {
    const messages = [...history, user("u-move", "Move Thursday's workout")];
    assert.deepEqual(visibleText(messages, "submitted"), [
      "Hi",
      "Welcome — want a plan?",
      "Move Thursday's workout",
    ]);
    assert.equal(isCoachReplyPending("submitted"), true);
  });

  it("holds a finished paragraph while a tool call is still running", () => {
    const messages: UIMessage[] = [
      ...history,
      user("u-move", "Move Thursday's workout"),
      message("a-live", "assistant", [
        textPart("Updating Thursday to easy.", "done"),
        {
          type: "dynamic-tool",
          toolName: "edit_plan_schedule",
          toolCallId: "call-1",
          state: "input-streaming",
          input: undefined,
        } as UIMessage["parts"][number],
      ]),
    ];

    assert.equal(
      visibleText(messages, "streaming").some((text) =>
        text.includes("Updating Thursday to easy."),
      ),
      false,
    );
  });

  it("reveals the full bubble once, with tool and reasoning parts left out", () => {
    const messages: UIMessage[] = [
      ...history,
      user("u-move", "Move Thursday's workout"),
      message("a-live", "assistant", [
        { type: "reasoning", text: REASONING, state: "done" },
        textPart("Updating Thursday to easy.", "done"),
        {
          type: "dynamic-tool",
          toolName: "edit_plan_schedule",
          toolCallId: "call-1",
          state: "output-available",
          input: { note: TOOL_PAYLOAD },
          output: { ok: true },
        } as UIMessage["parts"][number],
        textPart("Done — Thursday is an easy 4 miles.", "done"),
      ]),
    ];

    assert.equal(isCoachReplyPending("ready"), false);
    assert.deepEqual(visibleText(messages, "ready"), [
      "Hi",
      "Welcome — want a plan?",
      "Move Thursday's workout",
      FULL_REPLY,
    ]);
    assert.equal(coachingTextFromMessage(messages[3]!).includes(TOOL_PAYLOAD), false);
    assert.equal(coachingTextFromMessage(messages[3]!).includes(REASONING), false);
    assert.equal(
      coachingTextFromMessage(messages[3]!),
      "Updating Thursday to easy.\n\nDone — Thursday is an easy 4 miles.",
    );
  });

  it("drops a failed turn's partial reply so it does not resurface as history", () => {
    const failed = openTurn(PARTIAL);
    const kept = messagesToDisplay(failed, "error");
    assert.deepEqual(
      kept.map((message) => message.id),
      ["u-hi", "a-welcome", "u-move"],
    );
    assert.equal(isCoachReplyPending("error"), false);

    const next = messagesToDisplay(
      [
        ...kept,
        user("u-retry", "Try again"),
        assistant("a-next", "Still writing", "streaming"),
      ],
      "streaming",
    );
    const texts = next.map(coachingTextFromMessage).filter(Boolean);
    assert.equal(texts.includes(PARTIAL), false);
    assert.equal(texts.includes("Still writing"), false);
    assert.equal(texts.includes("Try again"), true);
    assert.equal(texts.includes("Welcome — want a plan?"), true);
  });

  it("leaves saved history alone for ready and unknown statuses", () => {
    const saved = openTurn(FULL_REPLY.replace("\n\n", " "));
    for (const status of ["ready", "", "idle"]) {
      assert.equal(messagesToDisplay(saved, status).length, saved.length);
      assert.equal(isCoachReplyPending(status), false);
    }
  });

  it("ignores blank text parts", () => {
    const blank = message("a-blank", "assistant", [
      textPart("   "),
      textPart("\n"),
    ]);
    assert.equal(coachingTextFromMessage(blank), "");
    assert.deepEqual(visibleText([user("u", "Hi"), blank], "ready"), ["Hi"]);
  });
});

describe("coach transcript markup", () => {
  it("shows the thinking indicator and no partial tokens while streaming", () => {
    const html = renderToStaticMarkup(
      <CoachMessageList messages={openTurn(PARTIAL)} status="streaming" />,
    );

    assert.equal(html.includes(PARTIAL), false);
    assert.equal(html.includes("Updating Thursday"), false);
    assert.match(html, /aria-label="Coach is thinking"/);
    assert.equal(html.includes("Welcome — want a plan?"), true);
    assert.equal(html.includes("Move Thursday&#x27;s workout"), true);
    assert.equal(count(html, ">Steen<"), 1);
  });

  it("paints the finished reply in one bubble and clears the indicator", () => {
    const done: UIMessage[] = [
      ...history,
      user("u-move", "Move Thursday's workout"),
      message("a-live", "assistant", [
        { type: "reasoning", text: REASONING, state: "done" },
        textPart("Updating Thursday to easy.", "done"),
        {
          type: "dynamic-tool",
          toolName: "edit_plan_schedule",
          toolCallId: "call-1",
          state: "output-available",
          input: { note: TOOL_PAYLOAD },
          output: { ok: true },
        } as UIMessage["parts"][number],
        textPart("Done — Thursday is an easy 4 miles.", "done"),
      ]),
    ];
    const html = renderToStaticMarkup(
      <CoachMessageList messages={done} status="ready" />,
    );

    assert.equal(html.includes("Coach is thinking"), false);
    assert.equal(html.includes(REASONING), false);
    assert.equal(html.includes(TOOL_PAYLOAD), false);
    assert.equal(html.includes("edit_plan_schedule"), false);
    assert.equal(html.includes("Updating Thursday to easy."), true);
    assert.equal(html.includes("Done — Thursday is an easy 4 miles."), true);
    assert.equal(count(html, ">Steen<"), 2);
  });

  it("shows the error turn without a partial bubble or the thinking indicator", () => {
    const html = renderToStaticMarkup(
      <CoachMessageList messages={openTurn(PARTIAL)} status="error" />,
    );

    assert.equal(html.includes(PARTIAL), false);
    assert.equal(html.includes("Coach is thinking"), false);
    assert.equal(html.includes("Move Thursday&#x27;s workout"), true);
    assert.equal(count(html, ">Steen<"), 1);
  });
});

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
