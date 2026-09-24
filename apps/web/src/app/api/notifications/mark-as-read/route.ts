import { and, prisma, unreadNotificationCache } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

async function markAllAsRead() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.orm.public.Notifications.where((notification) =>
    and(notification.read.eq(false), notification.recipientId.eq(user.id))
  ).updateAndCount({ read: true });
  await unreadNotificationCache.reset(user.id);
  return Response.json({ success: true });
}

export const POST = markAllAsRead;
export const PATCH = markAllAsRead;
