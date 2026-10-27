/**
 * What the coach chat paints while a turn is in flight.
 *
 * The /api/chat route still streams. Tool calls, the xAI credits error
 * mapping, and message persistence all run on that stream. The transcript
 * just refuses to paint assistant text until the turn leaves "streaming",
 * so the reply shows up as one bubble instead of token by token.
 *
 * A text part can already be "done" while a later tool step is still
 * running. Hold the whole open turn, not each part.
 */

const OPEN_TURN_STATUSES = new Set(["submitted", "streaming", "error"]);

export type CoachTranscriptMessage = {
  role: string;
  parts?: readonly { type?: string; text?: unknown }[] | null;
};

/** Composer lock and the typing indicator. Failed turns use the error banner. */
export function isCoachReplyPending(status: string): boolean {
  return status === "submitted" || status === "streaming";
}

/**
 * Composer lock while a turn is streaming or while a dropped stream is still
 * being recovered from the database. Recovery can outlast the browser error.
 */
export function isCoachTurnBusy(
  status: string,
  checkingSavedReply = false,
): boolean {
  return isCoachReplyPending(status) || checkingSavedReply;
}

/**
 * Status passed to the transcript. Recovery keeps the thinking indicator up
 * and holds the error banner back until polling finishes.
 */
export function coachTranscriptStatus(
  status: string,
  options: { streamRecovered?: boolean; checkingSavedReply?: boolean } = {},
): string {
  if (options.streamRecovered) return "ready";
  if (options.checkingSavedReply) return "streaming";
  return status;
}

/**
 * Coaching copy only. Tool calls, reasoning, and blank text parts stay out
 * of the bubble.
 */
export function coachingTextFromMessage(message: CoachTranscriptMessage): string {
  const chunks: string[] = [];
  for (const part of message.parts ?? []) {
    if (part?.type !== "text" || typeof part.text !== "string") continue;
    const text = part.text.trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n").trim();
}

/**
 * Messages to render.
 *
 * While a turn is submitted, streaming, or failed, assistant messages that
 * belong to that turn are omitted. Earlier turns stay visible. Any other
 * status (including the initial "ready") returns the full transcript so
 * saved history is not held back.
 */
export function messagesToDisplay<T extends CoachTranscriptMessage>(
  messages: readonly T[],
  status: string,
): T[] {
  if (!OPEN_TURN_STATUSES.has(status)) return [...messages];

  let lastUserIndex = -1;
  for (let index = 0; index < messages.length; index++) {
    if (messages[index]?.role === "user") lastUserIndex = index;
  }

  return messages.filter((message, index) => {
    if (message.role !== "assistant") return true;
    return lastUserIndex >= 0 && index < lastUserIndex;
  });
}
