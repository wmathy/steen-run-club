import { randomUUID } from "crypto";
import type { UIMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { withUserLock } from "@/lib/mutex";
import { MAX_CHAT_MESSAGES, MAX_CHAT_TEXT_CHARS } from "@/lib/validation";

export const COACH_PLAN_SAVED_TEXT =
  "Your new training plan is saved and active in the Plan tab.";

export const COACH_SCHEDULE_UPDATED_TEXT =
  "Your plan schedule is updated in the Plan tab.";

export const COACH_RUN_SAVED_TEXT = "Your run is saved.";

export const COACH_PROFILE_UPDATED_TEXT = "Your coach profile is updated.";

export const COACH_CALENDAR_UPDATED_TEXT = "Those workouts are on your calendar.";

const WRITE_TOOL_COACHING: Record<string, string> = {
  save_or_update_plan: COACH_PLAN_SAVED_TEXT,
  edit_plan_schedule: COACH_SCHEDULE_UPDATED_TEXT,
  save_run: COACH_RUN_SAVED_TEXT,
  update_coach_profile: COACH_PROFILE_UPDATED_TEXT,
  create_calendar_events: COACH_CALENDAR_UPDATED_TEXT,
};

export type StoredChatMessageRow = {
  id: string;
  role: string;
  content: string;
  partsJson?: string | null;
};

type ToolSnapshot = {
  name: string;
  state?: string;
  output?: unknown;
  errorText?: unknown;
  preliminary?: boolean;
};

function extractText(message: UIMessage): string {
  if (!message.parts?.length) return "";
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
  return text.slice(0, MAX_CHAT_TEXT_CHARS);
}

function normalizeRole(role: string): string {
  return role === "assistant" || role === "system" ? role : "user";
}

function serverMessageId(): string {
  return randomUUID();
}

function coachingTextParts(message: UIMessage): UIMessage["parts"] {
  return (message.parts ?? []).filter((part) => {
    if (part.type !== "text") return false;
    return typeof part.text === "string" && part.text.trim().length > 0;
  });
}

function readToolCall(part: UIMessage["parts"][number]): ToolSnapshot | null {
  const record = part as {
    type?: string;
    state?: unknown;
    toolName?: unknown;
    output?: unknown;
    errorText?: unknown;
    preliminary?: unknown;
    toolInvocation?: {
      toolName?: unknown;
      state?: unknown;
      result?: unknown;
      output?: unknown;
      errorText?: unknown;
    };
  };

  if (record.type === "dynamic-tool" && typeof record.toolName === "string") {
    return {
      name: record.toolName,
      state: typeof record.state === "string" ? record.state : undefined,
      output: record.output,
      errorText: record.errorText,
      preliminary: record.preliminary === true,
    };
  }

  if (typeof record.type === "string" && record.type.startsWith("tool-")) {
    const name = record.type.slice("tool-".length);
    if (!name || name === "invocation") {
      const invocation = record.toolInvocation;
      if (!invocation || typeof invocation.toolName !== "string") return null;
      const state = typeof invocation.state === "string" ? invocation.state : undefined;
      return {
        name: invocation.toolName,
        state: state === "result" ? "output-available" : state,
        output: invocation.result ?? invocation.output,
        errorText: invocation.errorText,
      };
    }
    return {
      name,
      state: typeof record.state === "string" ? record.state : undefined,
      output: record.output,
      errorText: record.errorText,
      preliminary: record.preliminary === true,
    };
  }

  return null;
}

function toolSucceeded(tool: ToolSnapshot): boolean {
  if (tool.state === "output-error" || tool.state === "output-denied") return false;
  if (typeof tool.errorText === "string" && tool.errorText.trim()) return false;
  if (tool.state !== "output-available") return false;
  if (tool.output && typeof tool.output === "object" && "success" in tool.output) {
    return (tool.output as { success?: unknown }).success === true;
  }
  return tool.preliminary !== true;
}

function fallbackForSuccessfulWrites(message: UIMessage): string | null {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const part of message.parts ?? []) {
    const tool = readToolCall(part);
    if (!tool || !WRITE_TOOL_COACHING[tool.name] || !toolSucceeded(tool)) continue;
    const line = WRITE_TOOL_COACHING[tool.name]!;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines.length > 0 ? lines.join("\n\n") : null;
}

function assistantForPersist(
  message: UIMessage,
  hadStreamError: boolean,
): UIMessage | null {
  const textParts = coachingTextParts(message);
  if (textParts.length > 0) {
    return { id: message.id, role: "assistant", parts: textParts };
  }

  const fallback = fallbackForSuccessfulWrites(message);
  if (fallback) {
    return {
      id: message.id,
      role: "assistant",
      parts: [{ type: "text", text: fallback, state: "done" }],
    };
  }

  // No coaching text and no successful plan/run write. onEnd still runs
  // after onError (hadStreamError), and a dangling tool call
  // (output-error / input-available) is the same empty turn. Neither
  // becomes a Message row — including when the flag was not set.
  if (hadStreamError) return null;
  return null;
}

/**
 * What appendChatTurn and POST /api/chat onEnd write for one turn.
 * Successful plan/run tools without a text part get a coaching sentence.
 * Errored or empty assistant turns are omitted. Tool JSON is never stored.
 */
export function messagesForAppend(
  turnMessages: readonly UIMessage[],
  options?: { hadStreamError?: boolean },
): UIMessage[] {
  const hadStreamError = options?.hadStreamError === true;
  const prepared: UIMessage[] = [];
  for (const message of turnMessages) {
    if (message.role === "assistant") {
      const next = assistantForPersist(message, hadStreamError);
      if (next) prepared.push(next);
      continue;
    }
    const text = extractText(message).trim();
    if (!text) continue;
    const parts = coachingTextParts(message);
    prepared.push({
      id: message.id,
      role: message.role === "system" ? "system" : "user",
      parts: parts.length > 0 ? parts : [{ type: "text", text: extractText(message) }],
    });
  }
  return prepared;
}

/**
 * Historical rows as the model and the chat UI should see them.
 * Empty assistant rows (including the 8:01 PM failed tool calls) are
 * dropped. partsJson is ignored so old save_or_update_plan inputs are
 * not sent back to xAI.
 */
export function projectStoredChatMessages(
  rows: readonly StoredChatMessageRow[],
): UIMessage[] {
  const messages: UIMessage[] = [];
  for (const row of rows) {
    const content = typeof row.content === "string" ? row.content : "";
    // Drop legacy assistant rows saved with content "" (broken tool calls)
    // and any other row that has no coaching or user text.
    if (row.role === "assistant" && !content.trim()) continue;
    if (!content.trim()) continue;
    const role: UIMessage["role"] =
      row.role === "assistant" || row.role === "system" ? row.role : "user";
    messages.push({
      id: row.id,
      role,
      parts: [{ type: "text", text: content.slice(0, MAX_CHAT_TEXT_CHARS) }],
    });
  }
  return messages;
}

/**
 * Prefer stream/client id when unused or already owned by this user.
 * Never adopt another user's id.
 */
async function resolvePersistId(
  userId: string,
  candidateId: string | undefined,
): Promise<string> {
  if (!candidateId) return serverMessageId();
  const existing = await prisma.message.findUnique({
    where: { id: candidateId },
    select: { userId: true },
  });
  if (!existing) return candidateId;
  if (existing.userId === userId) return candidateId;
  return serverMessageId();
}

export async function loadChatMessages(userId: string): Promise<UIMessage[]> {
  const rows = await prisma.message.findMany({
    where: {
      userId,
      // Legacy failed turns were stored with content "" and a broken tool
      // part. Leave them out of the cap so they cannot crowd out real turns.
      NOT: { role: "assistant", content: "" },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_CHAT_MESSAGES,
  });

  return projectStoredChatMessages(rows);
}

/**
 * Append a single chat turn (user message + resulting assistant messages)
 * under a per-user lock, re-reading existing rows first.
 *
 * Concurrent POSTs no longer clobber each other: each turn is inserted
 * onto whatever is currently in the DB, not a full replace of an
 * out-of-date in-memory transcript.
 */
export async function appendChatTurn(
  userId: string,
  turnMessages: UIMessage[],
  options?: { hadStreamError?: boolean },
): Promise<UIMessage[]> {
  if (!turnMessages.length) {
    return loadChatMessages(userId);
  }

  const prepared = messagesForAppend(turnMessages, options);
  if (!prepared.length) {
    return loadChatMessages(userId);
  }

  return withUserLock(`chat:${userId}`, async () => {
    const existingIds = new Set(
      (
        await prisma.message.findMany({
          where: { userId },
          select: { id: true },
        })
      ).map((r) => r.id),
    );

    let orderBase = Date.now();

    for (const m of prepared) {
      const content = extractText(m);
      const partsJson = JSON.stringify(m.parts ?? []).slice(0, 200_000);
      const role = normalizeRole(m.role);

      if (!content.trim()) continue;

      // Already persisted (e.g. retry / shared id) — update in place
      if (m.id && existingIds.has(m.id)) {
        const owned = await prisma.message.findFirst({
          where: { id: m.id, userId },
        });
        if (owned) {
          await prisma.message.update({
            where: { id: m.id },
            data: { content, partsJson, role },
          });
        }
        continue;
      }

      const id = await resolvePersistId(userId, m.id);
      await prisma.message.create({
        data: {
          id,
          userId,
          role,
          content,
          partsJson,
          createdAt: new Date(orderBase++),
        },
      });
      existingIds.add(id);
    }

    // Trim oldest if over cap
    const all = await prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (all.length > MAX_CHAT_MESSAGES) {
      const toDelete = all
        .slice(0, all.length - MAX_CHAT_MESSAGES)
        .map((r) => r.id);
      await prisma.message.deleteMany({
        where: { id: { in: toDelete }, userId },
      });
    }

    return loadChatMessages(userId);
  });
}

/**
 * Full replace of conversation (e.g. clear + rare admin). Prefer
 * appendChatTurn for normal chat turns.
 * Preserves ids when the same id is already owned by this user.
 */
export async function saveChatMessages(
  userId: string,
  messages: UIMessage[],
): Promise<void> {
  const capped = messagesForAppend(messages.slice(-MAX_CHAT_MESSAGES));

  await withUserLock(`chat:${userId}`, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { userId } });
      if (capped.length === 0) return;

      // Preserve stream/client ids within this replace when unique
      const used = new Set<string>();
      const rows = capped.map((m, index) => {
        const id =
          m.id && !used.has(m.id) ? m.id : serverMessageId();
        // After deleteMany, ids are free for this user; still avoid
        // collisions if another user somehow has the same id
        used.add(id);
        return {
          id,
          userId,
          role: normalizeRole(m.role),
          content: extractText(m),
          partsJson: JSON.stringify(m.parts ?? []).slice(0, 200_000),
          createdAt: new Date(Date.now() + index),
        };
      });

      // Filter ids that still exist for other users (edge case)
      for (const row of rows) {
        const clash = await tx.message.findUnique({
          where: { id: row.id },
          select: { userId: true },
        });
        if (clash && clash.userId !== userId) {
          row.id = serverMessageId();
        }
      }

      await tx.message.createMany({ data: rows });
    });
  });
}

/**
 * Append messages for a user. Verifies ownership on update; refuses to
 * overwrite another user's message id.
 */
export async function appendMessages(
  userId: string,
  messages: UIMessage[],
): Promise<void> {
  if (!messages.length) return;
  await appendChatTurn(userId, messages);
}

export async function clearChatMessages(userId: string): Promise<void> {
  await withUserLock(`chat:${userId}`, async () => {
    await prisma.message.deleteMany({ where: { userId } });
  });
}
