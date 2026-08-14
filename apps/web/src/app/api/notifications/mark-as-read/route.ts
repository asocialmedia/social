import { prisma, unreadNotificationCache } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

async function markAllAsRead() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.notification.updateMany({
    data: { read: true },
    where: { read: false, recipientId: user.id },
  });
  await unreadNotificationCache.reset(user.id);
  return Response.json({ success: true });
}

export const POST = markAllAsRead;
export const PATCH = markAllAsRead;
