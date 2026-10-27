import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchChatWithImmediateRetry } from "@/lib/chat-fetch";

describe("immediate chat connection retry", () => {
  it("retries a Safari Load failed once and then returns the response", async () => {
    const calls: string[] = [];
    const response = new Response("ok", { status: 200 });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (calls.length === 1) throw new TypeError("Load failed");
      return response;
    }) as typeof fetch;

    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await fetchChatWithImmediateRetry("/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      });
      assert.equal(result, response);
      assert.deepEqual(calls, ["/api/chat", "/api/chat"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not retry an aborted send or a second connection failure", async () => {
    const original = globalThis.fetch;
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    try {
      globalThis.fetch = (async () => {
        calls += 1;
        throw new DOMException("The operation was aborted.", "AbortError");
      }) as typeof fetch;
      await assert.rejects(
        () => fetchChatWithImmediateRetry("/api/chat", { signal: controller.signal }),
        { name: "AbortError" },
      );
      assert.equal(calls, 1);

      calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        throw new TypeError("Load failed");
      }) as typeof fetch;
      await assert.rejects(
        () => fetchChatWithImmediateRetry("/api/chat", { method: "POST" }),
        { name: "TypeError" },
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
