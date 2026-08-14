import { notificationsInclude, prisma } from "@asm/db";
import type { NotificationsPage } from "@asm/db";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/session";

export async function GET(req: NextRequest) {
  try {
    const cursor = req.nextUrl.searchParams.get("cursor") || undefined;
    const type = req.nextUrl.searchParams.get("type");
    const pageSize = 10;
    const session = await getSessionFromApi();
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;
    const notifications = await prisma.notification.findMany({
      cursor: cursor ? { id: cursor } : undefined,
      include: notificationsInclude,
      orderBy: { createdAt: "desc" },
      take: pageSize + 1,
      where: {
        recipientId: userId,
        ...(type === "mentions" ? { type: "MENTION" } : {}),
      },
    });
    const nextCursor =
      notifications.length > pageSize && notifications[pageSize]
        ? notifications[pageSize].id
        : null;
    const data: NotificationsPage = {
      nextCursor,
      notifications: notifications.slice(0, pageSize),
    };
    return Response.json(data);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
