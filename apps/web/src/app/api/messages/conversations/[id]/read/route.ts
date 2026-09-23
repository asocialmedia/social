import { prisma, publishConversationRead, unreadMessageCache } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  getConversationForUser,
  unreadMessageWhere,
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

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );
  if (!myMember) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Decrement the badge by exactly the number of messages that were unread.
  // Aligned with the writer: the sender never accrues a badge, and deleted
  // messages do not count, so the decrement cannot over-credit.
  const unread = await prisma.message.count({
    where: unreadMessageWhere({
      conversationId: id,
      lastReadAt: myMember.lastReadAt,
      userId: user.id,
    }),
  });
  if (unread > 0) {
    await unreadMessageCache.decrement(user.id, unread);
  }

  const readAt = new Date();

  await prisma.messageConversationMember.update({
    // Reading implies delivery, so advance both watermarks in one write: a
    // sender that only learns the read watermark still counts every earlier own
    // message as delivered.
    data: { lastDeliveredAt: readAt, lastReadAt: readAt },
    where: {
      conversationId_userId: { conversationId: id, userId: user.id },
    },
  });

  await publishConversationRead(id, user.id, readAt.toISOString());

  return Response.json({ ok: true });
}
