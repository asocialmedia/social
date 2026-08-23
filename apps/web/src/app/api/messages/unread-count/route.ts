import type { MessageCountInfo } from "@asm/db";
import { prisma, unreadMessageCache } from "@asm/db";

import { unreadMessageWhere } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cached = await unreadMessageCache.get(user.id);
  if (cached !== null) {
    return Response.json({ unreadCount: cached } satisfies MessageCountInfo);
  }

  // Seed the Redis counter from the DB baseline so subsequent increments
  // build on the correct number (mirrors the notification badge flow). Each
  // conversation is bounded by its OWN read watermark - the global earliest
  // read would over-count threads the user has already read. Conversations
  // with a blocked partner are excluded entirely: blocked pairs must not see
  // each other's activity, unread badges included.
  const [memberships, iBlocked, blockedMe] = await Promise.all([
    prisma.messageConversationMember.findMany({
      select: { conversationId: true, lastReadAt: true },
      where: { userId: user.id },
    }),
    prisma.block.findMany({
      select: { blockedId: true },
      where: { blockerId: user.id },
    }),
    prisma.block.findMany({
      select: { blockerId: true },
      where: { blockedId: user.id },
    }),
  ]);
  const hiddenPartnerIds = new Set<string>([
    ...iBlocked.map((row) => row.blockedId),
    ...blockedMe.map((row) => row.blockerId),
  ]);
  let visibleMemberships = memberships;
  if (hiddenPartnerIds.size !== 0) {
    const resolved = await Promise.all(
      memberships.map(async (membership) => {
        const other = await prisma.messageConversationMember.findFirst({
          select: { userId: true },
          where: {
            conversationId: membership.conversationId,
            userId: { not: user.id },
          },
        });
        return other && hiddenPartnerIds.has(other.userId) ? null : membership;
      })
    );
    visibleMemberships = resolved.filter((membership) => membership !== null);
  }

  let unreadCount = 0;
  if (visibleMemberships.length > 0) {
    const counts = await Promise.all(
      visibleMemberships.map((membership) =>
        prisma.message.count({
          where: unreadMessageWhere({
            conversationId: membership.conversationId,
            lastReadAt: membership.lastReadAt,
            userId: user.id,
          }),
        })
      )
    );
    unreadCount = counts.reduce((sum, count) => sum + count, 0);
  }

  if (unreadCount > 0) {
    await unreadMessageCache.increment(user.id, unreadCount);
  }

  return Response.json({ unreadCount } satisfies MessageCountInfo);
}
