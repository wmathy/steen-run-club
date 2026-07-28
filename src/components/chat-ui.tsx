"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLogo } from "@/components/app-logo";
import { cn } from "@/lib/utils";

/** Coaching text only — hide tool calls, empty parts, and internal meta. */
function coachingTextFromMessage(message: UIMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      const t = part.text.trim();
      if (t) chunks.push(t);
    }
  }
  return chunks.join("\n\n").trim();
}

function MessageParts({ text }: { text: string }) {
  return (
    <div className="prose-chat whitespace-pre-wrap text-[15px] leading-relaxed sm:text-sm">
      {text}
    </div>
  );
}

/** How close to the bottom counts as "following" the stream (px). */
const STICK_BOTTOM_THRESHOLD = 120;

export function ChatUI({ initialMessages }: { initialMessages: UIMessage[] }) {
  const [input, setInput] = useState("");
  /** Show "Jump to latest" when user scrolled up during a long reply */
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** When true, new stream chunks keep the view pinned to the bottom */
  const stickToBottomRef = useRef(true);

  function isNearBottom(el: HTMLDivElement): boolean {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= STICK_BOTTOM_THRESHOLD;
  }

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    stickToBottomRef.current = near;
    setShowJumpToLatest(!near);
  }

  function jumpToLatest() {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    scrollToBottom("smooth");
  }

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = typeof window !== "undefined" && window.innerWidth < 768 ? 140 : 240;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }

  useEffect(() => {
    resizeTextarea();
  }, [input]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    messages: initialMessages,
    transport,
    onFinish: async ({ messages: finished, isError, isAbort }) => {
      if (isError || isAbort) return;

      const clientCount = finished.length;
      const lastUser = [...finished].reverse().find((m) => m.role === "user");
      const lastUserText =
        lastUser?.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n")
          .trim() ?? "";

      try {
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          const res = await fetch("/api/chat");
          if (!res.ok) continue;
          const data = (await res.json()) as { messages?: UIMessage[] };
          if (!Array.isArray(data.messages)) continue;

          const server = data.messages;
          const serverHasLastUser =
            !lastUserText ||
            server.some((m) => {
              if (m.role !== "user") return false;
              const t = m.parts
                ?.filter(
                  (p): p is { type: "text"; text: string } => p.type === "text",
                )
                .map((p) => p.text)
                .join("\n")
                .trim();
              return t === lastUserText || t?.includes(lastUserText.slice(0, 200));
            });

          if (serverHasLastUser && server.length >= Math.min(clientCount, 2)) {
            setMessages(server);
            return;
          }
        }
      } catch {
        // non-fatal
      }
    },
  });

  // Auto-follow only if the user hasn't scrolled up to read earlier text
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    // Instant scroll during stream so we don't fight touch gestures with "smooth"
    const behavior: ScrollBehavior =
      status === "streaming" || status === "submitted" ? "auto" : "smooth";
    requestAnimationFrame(() => scrollToBottom(behavior));
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  function submitMessage() {
    const text = input.trim();
    if (!text || busy) return;
    // New send: pin to bottom so their message + reply are visible
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    sendMessage({ text });
    setInput("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      scrollToBottom("smooth");
    });
  }

  async function clearChat() {
    if (!confirm("Clear conversation history?")) return;
    await fetch("/api/chat", { method: "DELETE" });
    setMessages([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Compact header on mobile */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-card-border px-3 py-2.5 sm:px-4 md:px-6 md:py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold sm:text-base">
            Coach
          </h1>
          <p className="hidden text-xs text-muted sm:block">
            Assessment → plans → daily feedback
          </p>
        </div>
        <button
          type="button"
          onClick={clearChat}
          className="min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm text-muted active:bg-white/5 hover:text-danger"
        >
          Clear
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="absolute inset-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 touch-pan-y sm:space-y-4 sm:px-4 md:px-6 md:py-4"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {messages.length === 0 && (
          <div className="mx-auto max-w-md rounded-2xl border border-card-border bg-card/70 p-5 text-center sm:p-6">
            <div className="mb-3 flex justify-center sm:mb-4">
              <AppLogo size={56} />
            </div>
            <h2 className="mb-2 text-base font-semibold sm:text-lg">
              Welcome to Steen Run Club
            </h2>
            <p className="mb-4 text-sm text-muted">
              Your coach is ready. Start with a quick check-in so we can build a
              plan that fits your life.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
              {[
                "I'm new — help me start running 3x/week",
                "I have a half marathon in 12 weeks",
                "My knee niggles on long runs — what should I do?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => sendMessage({ text: suggestion })}
                  className="min-h-11 w-full rounded-xl border border-card-border bg-input-bg px-3 py-2.5 text-left text-sm text-foreground/90 transition active:bg-accent-soft sm:w-auto sm:rounded-full sm:py-1.5 sm:text-xs"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const text = coachingTextFromMessage(message);
          if (!text) return null;
          return (
            <div
              key={message.id}
              className={cn(
                "flex",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[min(100%,36rem)] rounded-2xl px-3.5 py-2.5 shadow-sm sm:px-4 sm:py-3",
                  message.role === "user"
                    ? "bg-user-bubble text-foreground"
                    : "border border-card-border bg-assistant-bubble",
                )}
              >
                {message.role === "assistant" && (
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-accent">
                    Steen
                  </div>
                )}
                <MessageParts text={text} />
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl border border-card-border bg-assistant-bubble px-4 py-3">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            Coach is temporarily unavailable. Please try again in a moment.
          </div>
        )}

        <div ref={bottomRef} className="h-1 shrink-0" />
      </div>

      {showJumpToLatest && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-card-border bg-card/95 px-3 py-2 text-xs font-medium text-accent shadow-lg backdrop-blur active:scale-[0.98]"
        >
          Jump to latest
        </button>
      )}
      </div>

      {/* Composer stays above bottom nav on mobile */}
      <form
        className="shrink-0 border-t border-card-border bg-card/80 p-2.5 backdrop-blur-sm sm:p-3 md:p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submitMessage();
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Desktop: Enter sends. Mobile: Enter = newline (easier on soft keyboards).
              const isMobile =
                typeof window !== "undefined" && window.innerWidth < 768;
              if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                e.preventDefault();
                if (!busy && input.trim()) submitMessage();
              }
            }}
            disabled={busy}
            rows={1}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="on"
            placeholder="Message your coach…"
            className="max-h-[140px] min-h-[48px] min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-card-border bg-input-bg px-3.5 py-3 text-base leading-relaxed outline-none ring-accent/40 placeholder:text-muted/70 focus:ring-2 disabled:opacity-60 sm:max-h-[240px] sm:text-sm md:rounded-xl"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-semibold text-black transition active:scale-[0.98] hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 md:h-auto md:rounded-xl md:py-3"
          >
            Send
          </button>
        </div>
        <p className="mx-auto mt-1 hidden max-w-3xl text-[11px] text-muted md:block">
          Enter to send · Shift+Enter for a new line
        </p>
      </form>
    </div>
  );
}
