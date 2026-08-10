import { type NotificationsPage, notificationsInclude, prisma } from "@asm/db";
import type { NextRequest } from "next/server";
import { getSessionFromApi } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
    const pageSize = 10;
    const session = await getSessionFromApi();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const notifications = await prisma.notification.findMany({
      where: {
        recipientId: userId,
      },
      include: notificationsInclude,
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      cursor: cursor ? { id: cursor } : undefined,
    });
    const nextCursor =
      notifications.length > pageSize && notifications[pageSize]
        ? notifications[pageSize].id
        : null;
    const data: NotificationsPage = {
      notifications: notifications.slice(0, pageSize),
      nextCursor,
    };
    return Response.json(data);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
