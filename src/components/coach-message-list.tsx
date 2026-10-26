import {
  coachingTextFromMessage,
  isCoachReplyPending,
  messagesToDisplay,
  type CoachTranscriptMessage,
} from "@/lib/coach-message-display";
import { cn } from "@/lib/utils";

function MessageParts({ text }: { text: string }) {
  return (
    <div className="prose-chat whitespace-pre-wrap text-[15px] leading-relaxed sm:text-sm">
      {text}
    </div>
  );
}

/**
 * Coach transcript. Assistant text for the open turn is rendered only once
 * `messagesToDisplay` releases it, which is when the turn is no longer
 * streaming. Until then the typing indicator is the only coach activity.
 */
export function CoachMessageList({
  messages,
  status,
}: {
  messages: readonly CoachTranscriptMessage[];
  status: string;
}) {
  const visible = messagesToDisplay(messages, status);
  const thinking = isCoachReplyPending(status);

  return (
    <>
      {visible.map((message, index) => {
        const text = coachingTextFromMessage(message);
        if (!text) return null;
        const key =
          "id" in message && typeof message.id === "string" && message.id
            ? message.id
            : `${message.role}-${index}`;
        return (
          <div
            key={key}
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

      {thinking && (
        <div className="flex justify-start">
          <div
            className="flex items-center gap-1.5 rounded-2xl border border-card-border bg-assistant-bubble px-4 py-3"
            role="status"
            aria-live="polite"
            aria-label="Coach is thinking"
          >
            <span
              className="typing-dot h-1.5 w-1.5 rounded-full bg-accent"
              aria-hidden="true"
            />
            <span
              className="typing-dot h-1.5 w-1.5 rounded-full bg-accent"
              aria-hidden="true"
            />
            <span
              className="typing-dot h-1.5 w-1.5 rounded-full bg-accent"
              aria-hidden="true"
            />
          </div>
        </div>
      )}
    </>
  );
}
