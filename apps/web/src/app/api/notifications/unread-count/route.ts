import type { NotificationCountInfo } from "@asm/db";
import { prisma, unreadNotificationCache } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // The worker keeps a near-instant unread counter in Redis. If it has never
  // been seeded, fall back to a direct DB count and seed the counter so
  // subsequent worker increments build on the correct baseline.
  const cached = await unreadNotificationCache.get(userId);
  if (cached !== null) {
    return Response.json({
      unreadCount: cached,
    } satisfies NotificationCountInfo);
  }

  const unreadCount = await prisma.notification.count({
    where: { recipientId: userId, read: false },
  });

  if (unreadCount > 0) {
    await unreadNotificationCache.increment(userId, unreadCount);
  }

  return Response.json({ unreadCount } satisfies NotificationCountInfo);
}
