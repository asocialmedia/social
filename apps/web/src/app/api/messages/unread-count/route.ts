import type { MessageCountInfo } from "@asm/db";
import { prisma, unreadMessageCache } from "@asm/db";

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
  // build on the correct number (mirrors the notification badge flow).
  const memberships = await prisma.messageConversationMember.findMany({
    select: { lastReadAt: true },
    where: { userId: user.id },
  });

  // No memberships means no conversations yet, so nothing can be unread.
  // Math.min(...[]) is Infinity, which would produce an Invalid Date below.
  let unreadCount = 0;
  if (memberships.length > 0) {
    const oldestReadAt = Math.min(
      ...memberships.map((member) => member.lastReadAt?.getTime() ?? 0)
    );
    unreadCount = await prisma.message.count({
      where: {
        conversation: {
          members: {
            some: { userId: user.id },
          },
        },
        createdAt: {
          gt: new Date(oldestReadAt),
        },
      },
    });
  }

  if (unreadCount > 0) {
    await unreadMessageCache.increment(user.id, unreadCount);
  }

  return Response.json({ unreadCount } satisfies MessageCountInfo);
}
