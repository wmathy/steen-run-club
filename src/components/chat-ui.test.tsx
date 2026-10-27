import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UIMessage } from "ai";
import { ChatRecoveryRegion } from "@/components/chat-recovery-region";
import { recoverChatOnVisible } from "@/lib/chat-stream-recovery";
import {
  COACH_TEMPORARILY_UNAVAILABLE_MESSAGE,
  COACH_XAI_CREDITS_MESSAGE,
} from "@/lib/coach-errors";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

const transcript: UIMessage[] = [
  user("u-old", "Earlier"),
  user("u-failed", "this send never reached the server"),
  user("u-new", "Build the 10-week plan"),
];

describe("chat-ui stream recovery", () => {
  it("hides the red error banner and shows the thinking indicator while checking a saved reply", () => {
    const html = renderToStaticMarkup(
      <ChatRecoveryRegion
        messages={transcript}
        status="error"
        error={new Error("Load failed")}
        checkingSavedReply
        streamRecovered={false}
      />,
    );

    assert.match(html, /aria-label="Coach is thinking"/);
    assert.equal(html.includes(COACH_TEMPORARILY_UNAVAILABLE_MESSAGE), false);
    assert.equal(html.includes("bg-danger/10"), false);
    assert.equal(html.includes("Build the 10-week plan"), true);
  });

  it("shows the red banner only after recovery finishes without a saved reply", () => {
    const html = renderToStaticMarkup(
      <ChatRecoveryRegion
        messages={transcript}
        status="error"
        error={new Error("Load failed")}
        checkingSavedReply={false}
        streamRecovered={false}
      />,
    );

    assert.equal(html.includes("Coach is thinking"), false);
    assert.equal(html.includes(COACH_TEMPORARILY_UNAVAILABLE_MESSAGE), true);
    assert.equal(html.includes("bg-danger/10"), true);
  });

  it("keeps the credit banner up even if a saved-reply check is still flagged", () => {
    const html = renderToStaticMarkup(
      <ChatRecoveryRegion
        messages={transcript}
        status="error"
        error={new Error("used all available credits")}
        checkingSavedReply
        streamRecovered={false}
        creditError
      />,
    );

    assert.equal(html.includes(COACH_XAI_CREDITS_MESSAGE), true);
    assert.equal(html.includes("Coach is thinking"), false);
  });

  it("shows the saved reply and clears the banner once the stream is recovered", () => {
    const html = renderToStaticMarkup(
      <ChatRecoveryRegion
        messages={[
          user("u-new", "Build the 10-week plan"),
          assistant("a-new", "Your new training plan is saved and active in the Plan tab."),
        ]}
        status="error"
        error={new Error("Load failed")}
        checkingSavedReply={false}
        streamRecovered
      />,
    );

    assert.equal(html.includes(COACH_TEMPORARILY_UNAVAILABLE_MESSAGE), false);
    assert.equal(html.includes("Coach is thinking"), false);
    assert.equal(
      html.includes("Your new training plan is saved and active in the Plan tab."),
      true,
    );
  });

  it("recovers a saved reply when the document becomes visible", async () => {
    let refreshed = 0;
    let loads = 0;
    const server = [
      user("u-old", "Earlier"),
      assistant("a-old", "Welcome."),
      user("u-new", "Build the 10-week plan"),
      assistant(
        "a-new",
        "Your new training plan is saved and active in the Plan tab.",
      ),
    ];

    const hidden = await recoverChatOnVisible({
      visibilityState: "hidden",
      clientMessages: transcript,
      refresh: () => {
        refreshed += 1;
      },
      load: async () => {
        loads += 1;
        return server;
      },
    });
    assert.equal(hidden, null);
    assert.equal(refreshed, 0);
    assert.equal(loads, 0);

    const visible = await recoverChatOnVisible({
      visibilityState: "visible",
      clientMessages: transcript,
      refresh: () => {
        refreshed += 1;
      },
      load: async () => {
        loads += 1;
        return server;
      },
    });
    assert.equal(refreshed, 1);
    assert.equal(loads, 1);
    assert.equal(visible?.clearError, true);
    assert.equal(visible?.messages.at(-1)?.id, "a-new");
  });
});
