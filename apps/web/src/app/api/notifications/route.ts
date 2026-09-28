import {
  and,
  getNotificationDataQuery,
  mapNotificationData,
  prisma,
} from "@asm/db";
import type { NotificationsPage } from "@asm/db";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";

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
    let notificationQuery = getNotificationDataQuery(prisma.orm)
      .where((notification) =>
        and(
          notification.recipientId.eq(userId),
          ...(type === "mentions" ? [notification._type.eq("MENTION")] : [])
        )
      )
      .orderBy((notification) => notification.createdAt.desc())
      .limit(pageSize + 1);
    if (cursor) {
      // Prisma 8 cursors are keyset seeks built from the values passed in, so
      // every orderBy column needs one: the anchor's createdAt is read back
      // here because the page cursor only carries a notification id. The seek is
      // exclusive, so no .offset(1) hop is needed.
      const anchor = await prisma.orm.public.Notifications.select("createdAt")
        .where({ id: cursor })
        .first();
      if (anchor) {
        notificationQuery = notificationQuery.cursor({
          createdAt: anchor.createdAt,
          id: cursor,
        });
      }
    }
    const notifications = await notificationQuery
      .all()
      .then((rows) => rows.map(mapNotificationData));
    const nextCursor =
      notifications.length > pageSize && notifications[pageSize - 1]
        ? notifications[pageSize - 1].id
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
