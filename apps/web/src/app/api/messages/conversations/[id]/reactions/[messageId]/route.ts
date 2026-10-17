import {
  fromPrismaDateTime,
  consumeRateLimit,
  isMessageReactionEmoji,
  listMessageReactionSummaries,
  MessageReactionError,
  prisma,
  publishMessageReacted,
  toggleMessageReaction,
} from "@asm/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  getConversationForUser,
  hasLeftConversation,
  parseBoundedJsonBody,
} from "@/lib/messages/server";

interface RouteContext {
  params: Promise<{ id: string; messageId: string }>;
}

const bodySchema = z.object({
  emoji: z.string().min(1).max(32),
  sessionId: z.uuid().optional(),
});

export async function GET(request: Request, context: RouteContext) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeRateLimit({
    bucket: "message-reactions-read",
    identifier: user.id,
    limit: 600,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id, messageId } = await context.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (hasLeftConversation(conversation, user.id)) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (sessionId !== null && !z.uuid().safeParse(sessionId).success) {
    return Response.json({ error: "Invalid message source" }, { status: 400 });
  }
  try {
    const valid = sessionId
      ? await isLiveIncognitoMessage(id, messageId, sessionId)
      : await isLiveNormalMessage(id, messageId);
    if (!valid) {
      return Response.json({ error: "Message not found" }, { status: 404 });
    }
    const summaries = await listMessageReactionSummaries(
      id,
      user.id,
      sessionId ? [] : [messageId],
      sessionId ? [messageId] : []
    );
    return NextResponse.json(
      { reactions: summaries.get(messageId) ?? [] },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return Response.json({ error: "Couldn't load reactions" }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeRateLimit({
    bucket: "message-reactions-write",
    identifier: user.id,
    limit: 180,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 1024);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 413 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isMessageReactionEmoji(parsed.data.emoji)) {
    return Response.json(
      { error: "Choose a supported reaction" },
      { status: 400 }
    );
  }

  const { id, messageId } = await context.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (hasLeftConversation(conversation, user.id)) {
    return Response.json(
      { error: "You can no longer react here" },
      { status: 403 }
    );
  }
  try {
    const reactions = await toggleMessageReaction({
      conversationId: id,
      emoji: parsed.data.emoji,
      messageId,
      sessionId: parsed.data.sessionId,
      userId: user.id,
    });
    try {
      await publishMessageReacted(
        id,
        messageId,
        user.id,
        parsed.data.sessionId
      );
    } catch {
      // The committed reaction is read on the next page refresh if Redis is unavailable.
    }
    return NextResponse.json(
      { reactions },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof MessageReactionError) {
      return Response.json(
        { error: reactionErrorCopy(error.message) },
        { status: error.status }
      );
    }
    console.error("Message reaction failed:", error);
    return Response.json(
      { error: "Couldn't update reaction" },
      { status: 500 }
    );
  }
}

async function isLiveNormalMessage(
  conversationId: string,
  messageId: string
): Promise<boolean> {
  const message = await prisma.orm.public.Messages.where({
    conversationId,
    id: messageId,
  }).first();
  return Boolean(
    message &&
    !message.deletedAt &&
    (!message.expiresAt || fromPrismaDateTime(message.expiresAt) > new Date())
  );
}

async function isLiveIncognitoMessage(
  conversationId: string,
  messageId: string,
  sessionId: string
): Promise<boolean> {
  const message = await prisma.orm.public.MessageIncognitoMessages.where({
    id: messageId,
    sessionId,
  }).first();
  if (
    !message ||
    Date.now() - fromPrismaDateTime(message.createdAt).getTime() >=
      24 * 60 * 60 * 1000
  ) {
    return false;
  }
  const activeSession = await prisma.orm.public.MessageIncognitoSessions.where({
    conversationId,
    id: sessionId,
  })
    .where((sessionRow) => sessionRow.endedAt.isNull())
    .first();
  return Boolean(activeSession);
}

function reactionErrorCopy(code: string): string {
  if (code === "INVALID_EMOJI") {
    return "Choose a supported reaction.";
  }
  if (code === "NOT_ALLOWED") {
    return "You can no longer react here.";
  }
  return "This message is no longer available.";
}
