import { and, prisma, unreadNotificationCache } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ notificationId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { notificationId } = await ctx.params;
  // Support both single notification ID and comma-separated IDs for grouped dismissals
  const ids = notificationId.includes(",")
    ? notificationId
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [notificationId];

  const deleted = await prisma.orm.public.Notifications.where((notification) =>
    and(notification.id.in(ids), notification.recipientId.eq(user.id))
  ).deleteAndCount();

  if (deleted === 0) {
    return Response.json({ error: "Notification not found" }, { status: 404 });
  }

  await unreadNotificationCache.reset(user.id);

  return Response.json({ success: true });
}
