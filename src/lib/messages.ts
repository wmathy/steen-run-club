import { randomUUID } from "crypto";
import type { UIMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { withUserLock } from "@/lib/mutex";
import { MAX_CHAT_MESSAGES, MAX_CHAT_TEXT_CHARS } from "@/lib/validation";

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
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: MAX_CHAT_MESSAGES,
  });

  return rows.map((row) => {
    let parts: UIMessage["parts"] = [];
    try {
      parts = JSON.parse(row.partsJson) as UIMessage["parts"];
    } catch {
      parts = [{ type: "text", text: row.content }];
    }
    if (!parts?.length && row.content) {
      parts = [{ type: "text", text: row.content }];
    }
    return {
      id: row.id,
      role: row.role as UIMessage["role"],
      parts,
    };
  });
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
): Promise<UIMessage[]> {
  if (!turnMessages.length) {
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

    for (const m of turnMessages) {
      const content = extractText(m);
      const partsJson = JSON.stringify(m.parts ?? []).slice(0, 200_000);
      const role = normalizeRole(m.role);

      // Skip empty user/assistant with no parts (shouldn't happen)
      if (!content && (!m.parts || m.parts.length === 0)) continue;

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
  const capped = messages.slice(-MAX_CHAT_MESSAGES);

  await withUserLock(`chat:${userId}`, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { userId } });
      if (capped.length === 0) return;

      // Preserve stream/client ids within this replace when unique
      const used = new Set<string>();
      const rows = capped.map((m, index) => {
        let id =
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
