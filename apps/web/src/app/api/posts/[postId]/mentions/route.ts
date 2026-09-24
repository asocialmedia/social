import { NotificationType, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  flushNotificationEvents,
  newNotificationEvents,
} from "@/lib/notifications/deferred-events";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await ctx.params;
  const mentions = await prisma.orm.public.Mentions.where({ postId }).all();
  return Response.json(mentions);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  try {
    const sessionResponse = await getSessionFromApi();
    if (!sessionResponse?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { user } = sessionResponse;

    const { userIds } = await request.json();
    const { postId } = await ctx.params;

    const filteredUserIds = Array.isArray(userIds)
      ? userIds.filter((id) => id !== user.id)
      : [];

    const post = await prisma.orm.public.Posts.select("userId")
      .where({ id: postId })
      .first();

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.userId !== user.id) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    const notificationEvents = newNotificationEvents();
    await prisma.transaction(async (tx) => {
      await tx.orm.public.Mentions.where({ postId }).delete();

      const mentionPromises = filteredUserIds.map((userId: string) =>
        tx.orm.public.Mentions.create({ postId, userId })
      );

      const notificationPromises = filteredUserIds.map((userId: string) =>
        tx.orm.public.Notifications.select("id", "recipientId").create({
          _type: NotificationType.MENTION,
          issuerId: user.id,
          postId,
          recipientId: userId,
        })
      );

      await Promise.all(mentionPromises);

      const createdNotifications = await Promise.all(notificationPromises);

      for (const notification of createdNotifications) {
        notificationEvents.created.push({
          notificationId: notification.id,
          recipientId: notification.recipientId,
        });
      }
    });
    // Committed: now the worker can see the rows it is told about.
    flushNotificationEvents(notificationEvents, "mention");

    const updatedMentions = await prisma.orm.public.Mentions.where({ postId })
      .include("user", (includedUser) =>
        includedUser.select("avatarUrl", "displayName", "id", "username")
      )
      .all();

    return Response.json({ mentions: updatedMentions.map((m) => m.user) });
  } catch (error) {
    console.error("Error updating mentions:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
