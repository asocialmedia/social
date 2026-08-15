import type { MessageCountInfo } from "@asm/db";
import { prisma, unreadMessageCache } from "@asm/db";

import { unreadMessageWhere } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

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
  // read would over-count threads the user has already read.
  const memberships = await prisma.messageConversationMember.findMany({
    select: { conversationId: true, lastReadAt: true },
    where: { userId: user.id },
  });

  let unreadCount = 0;
  if (memberships.length > 0) {
    const counts = await Promise.all(
      memberships.map((membership) =>
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
