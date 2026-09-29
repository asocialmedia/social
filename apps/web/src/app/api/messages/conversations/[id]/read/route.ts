import {
  and,
  prisma,
  publishConversationRead,
  toPrismaDateTime,
  unreadMessageCache,
  unreadMessageWhere,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { getConversationForUser } from "@/lib/messages/server";

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
  // Aligned with the writer: the sender never accrues a badge, deleted
  // messages do not count, and "delete for me" rows drop out, so the decrement
  // cannot over-credit.
  const unreadResult = await prisma.orm.public.Messages.where(
    unreadMessageWhere({
      conversationId: id,
      lastReadAt: myMember.lastReadAt,
      userId: user.id,
    })
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  const unread = unreadResult.count;
  if (unread > 0) {
    await unreadMessageCache.decrement(user.id, unread);
  }

  const readAt = new Date();

  await prisma.orm.public.MessageConversationMembers.where((member) =>
    and(member.conversationId.eq(id), member.userId.eq(user.id))
  ).update({
    // Reading implies delivery, so advance both watermarks in one write: a
    // sender that only learns the read watermark still counts every earlier own
    // message as delivered.
    lastDeliveredAt: toPrismaDateTime(readAt),
    lastReadAt: toPrismaDateTime(readAt),
  });

  await publishConversationRead(id, user.id, readAt.toISOString());

  return Response.json({ ok: true });
}
