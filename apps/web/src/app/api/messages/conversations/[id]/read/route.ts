import {
  commitMessageConversationRead,
  fromPrismaDateTime,
  listDenMembershipEvents,
  publishConversationRead,
  unreadMessageCache,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  DEN_READ_RECEIPT_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import { readerMessageWindows } from "@/lib/messages/reader-window";
import {
  getConversationForUser,
  hasLeftConversation,
  leftConversationResponse,
} from "@/lib/messages/server";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This route is a COUNT over the unread range plus a locked member-row
  // update, so it is not the cheap write it looks like from the client. Metered
  // before either.
  const limited = await consumeDenRateLimit(
    DEN_READ_RECEIPT_RATE_LIMIT,
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
  // The read gate admits somebody who left a den so they keep their history; this
  // is the write half of that split.
  if (hasLeftConversation(conversation, user.id)) {
    return leftConversationResponse();
  }

  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );
  if (!myMember) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  let result: Awaited<ReturnType<typeof commitMessageConversationRead>>;
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
    result = await commitMessageConversationRead({
      conversationId: id,
      membershipWindows,
      userId: user.id,
    });
  } catch (error) {
    console.error("Failed to mark message conversation read", error);
    return Response.json(
      { error: "Messages could not be marked read. Please try again." },
      { status: 503 }
    );
  }

  if (
    result.status === "conversation-not-found" ||
    result.status === "membership-not-found"
  ) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (result.status === "membership-ended") {
    return leftConversationResponse();
  }

  if (result.unreadCount > 0) {
    try {
      await unreadMessageCache.decrement(user.id, result.unreadCount);
    } catch (error) {
      console.error("Failed to decrement unread count after read", error);
    }
  }

  try {
    await publishConversationRead(id, user.id, result.readAt.toISOString());
  } catch (error) {
    console.error("Failed to publish conversation read", error);
  }

  return Response.json({ ok: true });
}
