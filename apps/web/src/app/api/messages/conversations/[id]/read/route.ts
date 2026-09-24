import {
  and,
  prisma,
  publishConversationRead,
  toPrismaDateTime,
  unreadMessageCache,
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
  // Aligned with the writer: the sender never accrues a badge, and deleted
  // messages do not count, so the decrement cannot over-credit.
  const unreadResult = await prisma.orm.public.Messages.where((message) =>
    and(
      message.conversationId.eq(id),
      message.createdAt.gt(
        toPrismaDateTime(myMember.lastReadAt ?? new Date(0))
      ),
      message.deletedAt.isNull(),
      message.senderId.notIn([user.id])
    )
  ).aggregate((aggregate) => ({ count: aggregate.count() }));
  const unread = unreadResult.count;
  if (unread > 0) {
    await unreadMessageCache.decrement(user.id, unread);
  }

  await prisma.orm.public.MessageConversationMembers.where((member) =>
    and(member.conversationId.eq(id), member.userId.eq(user.id))
  ).update({ lastReadAt: toPrismaDateTime(new Date()) });

  await publishConversationRead(id, user.id);

  return Response.json({ ok: true });
}
