import {
  chatLifecycleSnapshot,
  changeChatRetention,
  clearChatHistory,
  endIncognito,
  startIncognito,
  unreadMessageCache,
  publishChatLifecycleChange,
} from "@asm/db";
import { isUuid } from "@asm/messages";

import { getSessionFromApi } from "@/lib/auth/session";
import { consumeDenRateLimit } from "@/lib/messages/den-rate-limit";
import { lifecycleError } from "@/lib/messages/lifecycle-api";
import {
  getConversationForUser,
  isBlockedFromConversation,
  parseBoundedJsonBody,
} from "@/lib/messages/server";

const READ_LIMIT = {
  bucket: "chat-lifecycle-read",
  limit: 120,
  window: "fixed",
  windowSeconds: 60,
} as const;
const WRITE_LIMIT = {
  bucket: "chat-lifecycle-write",
  limit: 30,
  window: "fixed",
  windowSeconds: 60,
} as const;
interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: Context) {
  const awaitedChatState0 = await getSessionFromApi();
  const user = awaitedChatState0?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(READ_LIMIT, user.id);
  if (limited) {
    return limited;
  }
  const { id } = await context.params;
  try {
    const before = new URL(request.url).searchParams.get("before") ?? undefined;
    if (before && !isUuid(before)) {
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    }
    return Response.json(await chatLifecycleSnapshot(id, user.id, before), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return lifecycleError(error);
  }
}

export async function POST(request: Request, context: Context) {
  const awaitedChatState1 = await getSessionFromApi();
  const user = awaitedChatState1?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await consumeDenRateLimit(WRITE_LIMIT, user.id);
  if (limited) {
    return limited;
  }
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 20_000);
  } catch {
    return Response.json({ error: "Request is too large" }, { status: 413 });
  }
  if (!body || typeof body !== "object" || !("action" in body)) {
    return Response.json({ error: "Choose a chat action" }, { status: 400 });
  }
  try {
    const conversation = await getConversationForUser(id, user.id, {
      enforceBlocks: false,
    });
    if (!conversation) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }
    if (body.action === "start-incognito") {
      if (await isBlockedFromConversation(conversation, user.id)) {
        return Response.json(
          { error: "You cannot message this user" },
          { status: 403 }
        );
      }
      if (!("actionId" in body) || !isUuid(body.actionId)) {
        return Response.json({ error: "Invalid chat action" }, { status: 400 });
      }
      const { actionId } = body;
      await startIncognito(id, user.id, actionId);
    } else if (
      body.action === "end-incognito" &&
      "sessionId" in body &&
      isUuid(body.sessionId)
    ) {
      await endIncognito(id, user.id, body.sessionId);
    } else if (body.action === "clear") {
      if (
        !("throughSequence" in body) ||
        typeof body.throughSequence !== "number"
      ) {
        return Response.json(
          { error: "Refresh before deleting your chat" },
          { status: 400 }
        );
      }
      const through = body.throughSequence;
      await clearChatHistory(id, user.id, through);
      await unreadMessageCache.reset(user.id);
    } else if (
      body.action === "retention" &&
      "seconds" in body &&
      typeof body.seconds === "number" &&
      "version" in body &&
      typeof body.version === "number"
    ) {
      await changeChatRetention(id, user.id, body.seconds, body.version);
    } else {
      return Response.json({ error: "Invalid chat action" }, { status: 400 });
    }
    await publishChatLifecycleChange(id);
    return Response.json(await chatLifecycleSnapshot(id, user.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return lifecycleError(error);
  }
}
