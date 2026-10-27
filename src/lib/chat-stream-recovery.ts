/**
 * Recover a coach reply when the browser drops a long /api/chat stream
 * (iOS Safari "Load failed") while the server is still saving to the database.
 */

import { coachingTextFromMessage } from "@/lib/coach-message-display";

export const CHAT_STREAM_RECOVERY_INTERVAL_MS = 4_000;
/** Long enough for one slow plan-generation turn after Safari drops the stream. */
export const CHAT_STREAM_RECOVERY_WINDOW_MS = 240_000;

export type RecoveryMessage = {
  id?: string;
  role: string;
  parts?: ReadonlyArray<{ type?: string; text?: unknown }> | null;
};

function userCount(messages: readonly RecoveryMessage[]): number {
  return messages.reduce(
    (count, message) => count + (message.role === "user" ? 1 : 0),
    0,
  );
}

function lastUser(messages: readonly RecoveryMessage[]): RecoveryMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return undefined;
}

function textsMatch(serverText: string, userText: string): boolean {
  if (!userText) return false;
  if (serverText === userText) return true;
  const prefix = userText.slice(0, 200);
  return prefix.length > 0 && serverText.includes(prefix);
}

function assistantAfter(
  messages: readonly RecoveryMessage[],
  userIndex: number,
): RecoveryMessage | undefined {
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    if (coachingTextFromMessage(message)) return message;
  }
  return undefined;
}

/**
 * True when the database has an assistant reply for the athlete's latest
 * turn that the dropped stream never delivered.
 */
export function hasNewAssistantReply(
  clientMessages: readonly RecoveryMessage[],
  serverMessages: readonly RecoveryMessage[],
): boolean {
  if (serverMessages.length === 0) return false;
  if (userCount(serverMessages) < userCount(clientMessages)) return false;

  const clientUser = lastUser(clientMessages);
  const userText = clientUser ? coachingTextFromMessage(clientUser) : "";
  if (!userText) return false;

  let serverUserIndex = -1;
  for (let index = serverMessages.length - 1; index >= 0; index -= 1) {
    if (serverMessages[index]?.role !== "user") continue;
    serverUserIndex = index;
    break;
  }
  if (serverUserIndex < 0) return false;
  if (!textsMatch(coachingTextFromMessage(serverMessages[serverUserIndex]!), userText)) {
    return false;
  }

  const assistant = assistantAfter(serverMessages, serverUserIndex);
  if (!assistant) return false;
  if (serverMessages.length > clientMessages.length) return true;
  if (assistant.id && !clientMessages.some((message) => message.id === assistant.id)) {
    return true;
  }
  const copy = assistant.id
    ? clientMessages.find((message) => message.id === assistant.id)
    : undefined;
  if (!copy) return !assistant.id ? serverMessages.length > clientMessages.length : true;
  return coachingTextFromMessage(copy) !== coachingTextFromMessage(assistant);
}

export async function pollForSavedChatReply<T extends RecoveryMessage>(options: {
  snapshot: readonly T[];
  load: () => Promise<readonly T[] | null>;
  shouldContinue?: () => boolean;
  intervalMs?: number;
  windowMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<T[] | null> {
  const intervalMs = options.intervalMs ?? CHAT_STREAM_RECOVERY_INTERVAL_MS;
  const windowMs = options.windowMs ?? CHAT_STREAM_RECOVERY_WINDOW_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const shouldContinue = options.shouldContinue ?? (() => true);
  const deadline = now() + windowMs;

  while (shouldContinue()) {
    if (now() >= deadline) return null;
    let server: readonly T[] | null = null;
    try {
      server = await options.load();
    } catch {
      server = null;
    }
    if (!shouldContinue()) return null;
    if (server && hasNewAssistantReply(options.snapshot, server)) {
      return [...server];
    }
    if (!shouldContinue()) return null;
    const remaining = deadline - now();
    if (remaining <= 0) return null;
    await sleep(Math.min(intervalMs, remaining));
  }
  return null;
}
