import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  UIMessage,
  stepCountIs,
} from "ai";
import { xai } from "@ai-sdk/xai";
import { AuthError, requireUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { buildCoachSystemPrompt } from "@/lib/coach-prompt";
import { createCoachTools } from "@/lib/tools";
import {
  appendChatTurn,
  clearChatMessages,
  loadChatMessages,
} from "@/lib/messages";
import { getClientIp, parseJsonBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_TEXT_CHARS,
} from "@/lib/validation";

export const maxDuration = 60;

function extractUserText(message: UIMessage): string {
  if (!message.parts?.length) return "";
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .slice(0, MAX_CHAT_TEXT_CHARS);
}

/**
 * Build conversation from DB + only the newest user turn.
 * Never trust a full client-supplied transcript as authoritative history.
 */
function resolveMessages(
  previous: UIMessage[],
  body: { messages?: UIMessage[]; message?: UIMessage },
): UIMessage[] | { error: string } {
  if (body.message && body.message.role === "user") {
    const text = extractUserText(body.message);
    if (!text.trim()) return { error: "Empty message" };
    return [
      ...previous.slice(-(MAX_CHAT_MESSAGES - 1)),
      {
        id: body.message.id || crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      },
    ];
  }

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const last = body.messages[body.messages.length - 1];
    if (!last || last.role !== "user") {
      return { error: "Last message must be from the user" };
    }
    const text = extractUserText(last);
    if (!text.trim()) return { error: "Empty message" };

    return [
      ...previous.slice(-(MAX_CHAT_MESSAGES - 1)),
      {
        id: last.id || crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      },
    ];
  }

  return { error: "No messages provided" };
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const messages = await loadChatMessages(userId);
    return Response.json({ messages });
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Chat GET error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();

    if (!process.env.XAI_API_KEY) {
      return Response.json(
        {
          error:
            "Coach is temporarily unavailable. The server is missing its AI configuration.",
        },
        { status: 503 },
      );
    }

    const ip = getClientIp(req);
    const userLimited = rateLimit(`chat:${userId}`, 40, 60 * 60_000);
    const ipLimited = rateLimit(`chat-ip:${ip}`, 80, 60 * 60_000);
    if (!userLimited.ok || !ipLimited.ok) {
      return Response.json(
        { error: "Rate limit exceeded. Please wait before chatting again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(
              Math.max(userLimited.retryAfterSec, ipLimited.retryAfterSec),
            ),
          },
        },
      );
    }

    const parsed = await parseJsonBody<{
      messages?: UIMessage[];
      message?: UIMessage;
    }>(req);
    if ("error" in parsed) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Load history for model context (not used as full replace on save)
    const previous = await loadChatMessages(userId);
    const previousIds = new Set(previous.map((m) => m.id));

    const resolved = resolveMessages(previous, parsed.data);
    if ("error" in resolved) {
      return Response.json({ error: resolved.error }, { status: 400 });
    }
    const messages = resolved;
    // Index of the new user message in the *resolved* context array
    // (may be shorter than previous.length when history is at MAX_CHAT_MESSAGES).
    const newUserIndex = messages.length - 1;
    const newUserId = messages[newUserIndex]?.id;

    const profile = await prisma.coachProfile.findUnique({
      where: { userId },
    });

    const tools = createCoachTools(userId);
    const system = buildCoachSystemPrompt(profile);

    const result = streamText({
      model: xai.chat("grok-4.5"),
      system,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(8),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        onEnd: async ({ messages: finalMessages }) => {
          try {
            // Persist this turn only: new user message + following assistants.
            // Prefer id match so truncation of history for model context cannot
            // drop the user turn (previous bug when previous.length === MAX).
            let turnStart = newUserId
              ? finalMessages.findIndex((m) => m.id === newUserId)
              : -1;
            if (turnStart < 0) {
              // Fallback: everything from the resolved user slot onward
              turnStart = Math.max(0, newUserIndex);
            }
            // Extra safety: skip any prefix that was already in DB history
            while (
              turnStart < finalMessages.length &&
              finalMessages[turnStart]?.id &&
              previousIds.has(finalMessages[turnStart]!.id) &&
              finalMessages[turnStart]!.role !== "user"
            ) {
              turnStart += 1;
            }
            // If we landed on a historical user id by accident, still take from
            // newUserIndex relative to finalMessages when lengths align.
            const turnMessages = finalMessages.slice(turnStart);
            // Only append messages not already stored (ids in previousIds)
            const toAppend = turnMessages.filter(
              (m) => !previousIds.has(m.id) || m.id === newUserId,
            );
            await appendChatTurn(
              userId,
              toAppend.length > 0 ? toAppend : turnMessages,
            );
          } catch (e) {
            console.error("Failed to persist chat:", e);
          }
        },
      }),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Chat error:", err);
    return Response.json(
      { error: "Coach is temporarily unavailable. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const userId = await requireUserId();
    await clearChatMessages(userId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Chat DELETE error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
