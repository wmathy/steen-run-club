import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAT_STREAM_RECOVERY_INTERVAL_MS,
  CHAT_STREAM_RECOVERY_WINDOW_MS,
  hasNewAssistantReply,
  pollForSavedChatReply,
  type RecoveryMessage,
} from "@/lib/chat-stream-recovery";

function user(id: string, text: string): RecoveryMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): RecoveryMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

describe("saved chat recovery", () => {
  it("sees an assistant saved after the athlete's latest message", () => {
    const client = [user("u1", "Build the 10-week plan")];
    const waiting = [user("u1", "Build the 10-week plan")];
    const saved = [
      user("u1", "Build the 10-week plan"),
      assistant("a1", "Your sub-18 block is on the Plan tab."),
    ];
    assert.equal(hasNewAssistantReply(client, waiting), false);
    assert.equal(hasNewAssistantReply(client, saved), true);
  });

  it("does not treat an older duplicate prompt as the new reply", () => {
    const client = [
      user("u-old", "Build the 10-week plan"),
      assistant("a-old", "Here is the first plan."),
      user("u-new", "Build the 10-week plan"),
    ];
    const serverBeforeSave = [
      user("u-old", "Build the 10-week plan"),
      assistant("a-old", "Here is the first plan."),
    ];
    assert.equal(hasNewAssistantReply(client, serverBeforeSave), false);
    const serverAfterSave = [
      ...serverBeforeSave,
      user("u-new", "Build the 10-week plan"),
      assistant("a-new", "Saved the post-Hixon block."),
    ];
    assert.equal(hasNewAssistantReply(client, serverAfterSave), true);
  });

  it("finds a saved reply when earlier failed sends left extra user messages on the client", () => {
    const client = [
      user("u-old", "Earlier question"),
      user("u-failed", "this send never reached the server"),
      user("u-new", "Build the 10-week plan"),
    ];
    const server = [
      user("u-old", "Earlier question"),
      assistant("a-old", "Here is the first answer."),
      user("u-new", "Build the 10-week plan"),
      assistant("a-new", "Your sub-18 block is on the Plan tab."),
    ];
    assert.equal(client.filter((message) => message.role === "user").length, 3);
    assert.equal(server.filter((message) => message.role === "user").length, 2);
    assert.equal(hasNewAssistantReply(client, server), true);
  });

  it("accepts a fuller copy of the assistant the dropped stream already started", () => {
    const partial = assistant("a1", "Working");
    const full = assistant("a1", "Your sub-18 block is on the Plan tab.");
    const client = [user("u1", "Build the plan"), partial];
    const server = [user("u1", "Build the plan"), full];
    assert.equal(hasNewAssistantReply(client, server), true);
  });

  it("polls immediately and then every 4 seconds until the reply is saved", async () => {
    let now = 0;
    const sleeps: number[] = [];
    let calls = 0;
    const snapshot = [user("u1", "Build the plan")];
    const saved = await pollForSavedChatReply({
      snapshot,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      load: async () => {
        calls += 1;
        if (calls < 3) return snapshot;
        return [...snapshot, assistant("a1", "Saved.")];
      },
    });
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [
      CHAT_STREAM_RECOVERY_INTERVAL_MS,
      CHAT_STREAM_RECOVERY_INTERVAL_MS,
    ]);
    assert.equal(saved?.at(-1)?.id, "a1");
  });

  it("stops when a newer message is sent", async () => {
    let open = true;
    let calls = 0;
    const saved = await pollForSavedChatReply({
      snapshot: [user("u1", "Build the plan")],
      now: () => 0,
      sleep: async () => {
        open = false;
      },
      shouldContinue: () => open,
      load: async () => {
        calls += 1;
        return [user("u1", "Build the plan")];
      },
    });
    assert.equal(saved, null);
    assert.equal(calls, 1);
  });

  it("gives up after the recovery window when nothing new was saved", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const saved = await pollForSavedChatReply({
      snapshot: [user("u1", "Build the plan")],
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      load: async () => [user("u1", "Build the plan")],
    });
    assert.equal(saved, null);
    assert.ok(sleeps.length > 0);
    assert.ok(sleeps.every((ms) => ms <= CHAT_STREAM_RECOVERY_INTERVAL_MS));
    assert.ok(now >= CHAT_STREAM_RECOVERY_WINDOW_MS);
  });
});
