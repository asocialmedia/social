import { enqueueNotificationCreated, NotificationType, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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
  const mentions = await prisma.mention.findMany({
    where: { postId },
  });
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

    const post = await prisma.post.findUnique({
      select: { userId: true },
      where: { id: postId },
    });

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.userId !== user.id) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.mention.deleteMany({
        where: { postId },
      });

      const mentionPromises = filteredUserIds.map((userId: string) =>
        tx.mention.create({
          data: {
            postId,
            userId,
          },
        })
      );

      const notificationPromises = filteredUserIds.map((userId: string) =>
        tx.notification.create({
          data: {
            issuerId: user.id,
            postId,
            recipientId: userId,
            type: NotificationType.MENTION,
          },
        })
      );

      await Promise.all([...mentionPromises, ...notificationPromises]);

      for (const userId of filteredUserIds) {
        enqueueNotificationCreated(userId).catch((error: unknown) => {
          console.error("Failed to enqueue mention notification event:", error);
        });
      }
    });

    const updatedMentions = await prisma.mention.findMany({
      include: {
        user: {
          select: {
            avatarUrl: true,
            displayName: true,
            id: true,
            username: true,
          },
        },
      },
      where: {
        postId,
      },
    });

    return Response.json({ mentions: updatedMentions.map((m) => m.user) });
  } catch (error) {
    console.error("Error updating mentions:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
