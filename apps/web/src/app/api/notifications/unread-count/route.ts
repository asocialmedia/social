import type { NotificationCountInfo } from "@asm/db";
import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const unreadCount = await prisma.notification.count({
    where: { recipientId: userId, read: false },
  });

  return Response.json({ unreadCount } satisfies NotificationCountInfo);
}
