import { prisma, publishConversationRead, unreadMessageCache } from "@asm/db";

import { getConversationForUser } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

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
  const unread = await prisma.message.count({
    where: {
      conversationId: id,
      createdAt: { gt: myMember.lastReadAt ?? new Date(0) },
    },
  });
  if (unread > 0) {
    await unreadMessageCache.decrement(user.id, unread);
  }

  await prisma.messageConversationMember.update({
    data: { lastReadAt: new Date() },
    where: {
      conversationId_userId: { conversationId: id, userId: user.id },
    },
  });

  await publishConversationRead(id, user.id);

  return Response.json({ ok: true });
}
