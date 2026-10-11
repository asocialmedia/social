import {
  commitMessageHides,
  fromPrismaDateTime,
  listDenMembershipEvents,
  unreadMessageCache,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  DEN_MESSAGE_HIDE_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import { MAX_HIDE_BATCH } from "@/lib/messages/message-delete";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import {
  getConversationForUser,
  hasLeftConversation,
  leftConversationResponse,
  parseJsonBody,
} from "@/lib/messages/server";

function readMessageIds(value: unknown): string[] | null {
  if (typeof value !== "object" || value === null || !("messageIds" in value)) {
    return null;
  }
  const rawIds = value.messageIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return null;
  }
  return [
    ...new Set(
      rawIds.filter(
        (messageId): messageId is string =>
          typeof messageId === "string" && messageId.length > 0
      )
    ),
  ];
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await consumeDenRateLimit(
    DEN_MESSAGE_HIDE_RATE_LIMIT,
    user.id
  );
  if (limited) {
    return limited;
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (hasLeftConversation(conversation, user.id)) {
    return leftConversationResponse();
  }
  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );
  if (!myMember) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messageIds = readMessageIds(await parseJsonBody(request));
  if (!messageIds) {
    return Response.json(
      { error: "messageIds must be a non-empty array" },
      { status: 400 }
    );
  }
  if (messageIds.length === 0 || messageIds.length > MAX_HIDE_BATCH) {
    return Response.json(
      { error: `messageIds must be 1 to ${MAX_HIDE_BATCH} ids` },
      { status: 400 }
    );
  }

  let result: Awaited<ReturnType<typeof commitMessageHides>>;
  try {
    const events =
      conversation.type === "DEN"
        ? await listDenMembershipEvents(id, myMember.leftAt ?? null)
        : [];
    const membershipWindows = readerMessageWindows({
      conversationType: conversation.type,
      events,
      membership: {
        createdAt: fromPrismaDateTime(myMember.createdAt),
        leftAt: myMember.leftAt ?? null,
      },
      userId: user.id,
    });
    result = await commitMessageHides({
      conversationId: id,
      membershipWindows,
      messageIds,
      userId: user.id,
    });
  } catch (error) {
    console.error("Failed to hide DM messages", error);
    return Response.json(
      { error: "Messages could not be hidden. Please try again." },
      { status: 503 }
    );
  }
  if (result.status === "membership-ended") {
    return leftConversationResponse();
  }

  if (result.unreadDecrement > 0) {
    try {
      await unreadMessageCache.decrement(user.id, result.unreadDecrement);
    } catch (error) {
      console.error("Failed to decrement unread count after hide:", error);
    }
  }

  return Response.json({ hidden: result.hidden });
}
