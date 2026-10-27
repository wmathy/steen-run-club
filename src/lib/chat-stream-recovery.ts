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

function lastUser(messages: readonly RecoveryMessage[]): RecoveryMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return undefined;
}

function normalizeChatText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function messageText(message: RecoveryMessage): string {
  return normalizeChatText(coachingTextFromMessage(message));
}

function textsMatch(serverText: string, userText: string): boolean {
  if (!userText || !serverText) return false;
  if (serverText === userText) return true;
  const prefix = userText.slice(0, 200);
  return prefix.length > 0 && serverText.includes(prefix);
}

function sameUserMessage(
  clientUser: RecoveryMessage,
  serverUser: RecoveryMessage,
): boolean {
  if (clientUser.id && serverUser.id && clientUser.id === serverUser.id) return true;
  return textsMatch(messageText(serverUser), messageText(clientUser));
}

function findServerUserIndex(
  clientUser: RecoveryMessage,
  serverMessages: readonly RecoveryMessage[],
): number {
  for (let index = serverMessages.length - 1; index >= 0; index -= 1) {
    const message = serverMessages[index];
    if (message?.role !== "user") continue;
    if (sameUserMessage(clientUser, message)) return index;
  }
  return -1;
}

function assistantAfter(
  messages: readonly RecoveryMessage[],
  userIndex: number,
): RecoveryMessage | undefined {
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "user") return undefined;
    if (message.role !== "assistant") continue;
    if (coachingTextFromMessage(message)) return message;
  }
  return undefined;
}

function assistantReplyIsNew(
  clientMessages: readonly RecoveryMessage[],
  assistant: RecoveryMessage,
): boolean {
  const text = messageText(assistant);
  if (!text) return false;
  if (assistant.id) {
    const copies = clientMessages.filter((message) => message.id === assistant.id);
    if (copies.length === 0) return true;
    return copies.some((copy) => messageText(copy) !== text);
  }
  return !clientMessages.some(
    (message) => message.role === "assistant" && messageText(message) === text,
  );
}

/** Assistant that was already the end of the transcript before this send. */
function assistantWasAlreadyAtEndBeforeSend(
  clientMessages: readonly RecoveryMessage[],
  assistant: RecoveryMessage,
): boolean {
  let end = clientMessages.length;
  while (end > 0 && clientMessages[end - 1]?.role === "user") end -= 1;
  const prior = end > 0 ? clientMessages[end - 1] : undefined;
  if (!prior || prior.role !== "assistant") return false;
  if (messageText(prior) !== messageText(assistant)) return false;
  if (assistant.id && prior.id && assistant.id !== prior.id) return false;
  return true;
}

/**
 * True when the database has an assistant reply for the athlete's latest
 * turn that the dropped stream never delivered.
 *
 * Extra unpersisted user messages from earlier failed sends in this tab
 * do not count. Match the latest client user by id or normalized text,
 * searching the saved transcript from the end.
 */
export function hasNewAssistantReply(
  clientMessages: readonly RecoveryMessage[],
  serverMessages: readonly RecoveryMessage[],
): boolean {
  if (serverMessages.length === 0) return false;

  const clientUser = lastUser(clientMessages);
  if (clientUser) {
    const serverUserIndex = findServerUserIndex(clientUser, serverMessages);
    if (serverUserIndex >= 0) {
      const assistant = assistantAfter(serverMessages, serverUserIndex);
      if (!assistant) return false;
      if (assistantWasAlreadyAtEndBeforeSend(clientMessages, assistant)) return false;
      return assistantReplyIsNew(clientMessages, assistant);
    }
  }

  const last = serverMessages[serverMessages.length - 1];
  if (!last || last.role !== "assistant" || !messageText(last)) return false;
  if (assistantWasAlreadyAtEndBeforeSend(clientMessages, last)) return false;
  return assistantReplyIsNew(clientMessages, last);
}

/**
 * Saved reply to apply when the athlete comes back to a backgrounded tab.
 * Null when the server does not yet have a new coaching reply.
 */
export function reconcileVisibleChat<T extends RecoveryMessage>(input: {
  clientMessages: readonly RecoveryMessage[];
  serverMessages: readonly T[];
}): { messages: T[]; clearError: true } | null {
  if (!hasNewAssistantReply(input.clientMessages, input.serverMessages)) return null;
  return { messages: [...input.serverMessages], clearError: true };
}

/**
 * visibilitychange handler. Refreshes server data when the page is shown
 * again and returns a saved reply that should replace a stale error.
 */
export async function recoverChatOnVisible<T extends RecoveryMessage>(options: {
  visibilityState: string;
  clientMessages: readonly RecoveryMessage[];
  load: () => Promise<readonly T[] | null>;
  refresh: () => void;
}): Promise<{ messages: T[]; clearError: true } | null> {
  if (options.visibilityState !== "visible") return null;
  options.refresh();
  let server: readonly T[] | null = null;
  try {
    server = await options.load();
  } catch {
    server = null;
  }
  if (!server) return null;
  return reconcileVisibleChat({
    clientMessages: options.clientMessages,
    serverMessages: server,
  });
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
