import { prisma, unreadNotificationCache } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

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

  const deleted = await prisma.notification.deleteMany({
    where: { id: notificationId, recipientId: user.id },
  });

  if (deleted.count === 0) {
    return Response.json({ error: "Notification not found" }, { status: 404 });
  }

  await unreadNotificationCache.reset(user.id);

  return Response.json({ success: true });
}
