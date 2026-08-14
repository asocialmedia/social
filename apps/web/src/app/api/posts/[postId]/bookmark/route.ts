import type { BookmarkInfo } from "@asm/db";
import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

// Aura awarded for curating content. Bookmarking credits both the bookmarker
// and (unless it is their own post) the post author.
const BOOKMARKED_AURA = 1;
const BOOKMARK_RECEIVED_AURA = 1;

export async function GET(
  _req: Request,
  props: { params: Promise<{ postId: string }> }
) {
  const params = await props.params;
  const { postId } = params;

  try {
    const sessionResponse = await getSessionFromApi();
    if (!sessionResponse?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loggedInUser = sessionResponse.user;

    const bookmark = await prisma.bookmark.findUnique({
      where: {
        userId_postId: {
          postId,
          userId: loggedInUser.id,
        },
      },
    });

    const data: BookmarkInfo = {
      isBookmarkedByUser: !!bookmark,
    };

    return Response.json(data);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await ctx.params;

  const post = await prisma.post.findUnique({
    select: { id: true, userId: true },
    where: { id: postId },
  });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  // Self-bookmarks are recorded but never award aura, to prevent users from
  // farming reputation on their own posts.
  const isSelfBookmark = post.userId === user.id;

  await prisma.$transaction(async (tx) => {
    // Skip when already bookmarked so repeated calls (double-clicks, retries)
    // are idempotent instead of erroring or double-awarding.
    const existingBookmark = await tx.bookmark.findUnique({
      where: {
        userId_postId: { postId, userId: user.id },
      },
    });

    if (existingBookmark) {
      return;
    }

    await tx.bookmark.create({ data: { postId, userId: user.id } });

    if (!isSelfBookmark) {
      await tx.user.update({
        data: { aura: { increment: BOOKMARKED_AURA } },
        where: { id: user.id },
      });

      await tx.auraLog.create({
        data: {
          amount: BOOKMARKED_AURA,
          issuerId: user.id,
          postId,
          type: "POST_BOOKMARKED",
          userId: user.id,
        },
      });

      await tx.user.update({
        data: { aura: { increment: BOOKMARK_RECEIVED_AURA } },
        where: { id: post.userId },
      });

      await tx.auraLog.create({
        data: {
          amount: BOOKMARK_RECEIVED_AURA,
          issuerId: user.id,
          postId,
          type: "POST_BOOKMARK_RECEIVED",
          userId: post.userId,
        },
      });
    }
  });

  return Response.json({ success: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await ctx.params;

  const post = await prisma.post.findUnique({
    select: { id: true, userId: true },
    where: { id: postId },
  });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const isSelfBookmark = post.userId === user.id;

  await prisma.$transaction(async (tx) => {
    const existingBookmark = await tx.bookmark.findUnique({
      where: {
        userId_postId: { postId, userId: user.id },
      },
    });

    // Only reverse aura when the bookmark actually existed and was awarded
    // (bookmarks created before this feature shipped never earned it).
    if (!existingBookmark) {
      return;
    }

    await tx.bookmark.deleteMany({ where: { postId, userId: user.id } });

    if (!isSelfBookmark) {
      const wasAwarded = await tx.auraLog.findFirst({
        where: {
          postId,
          type: "POST_BOOKMARKED",
          userId: user.id,
        },
      });

      if (wasAwarded) {
        await tx.user.update({
          data: { aura: { decrement: BOOKMARKED_AURA } },
          where: { id: user.id },
        });

        await tx.auraLog.create({
          data: {
            amount: -BOOKMARKED_AURA,
            issuerId: user.id,
            postId,
            type: "POST_BOOKMARKED",
            userId: user.id,
          },
        });

        await tx.user.update({
          data: { aura: { decrement: BOOKMARK_RECEIVED_AURA } },
          where: { id: post.userId },
        });

        await tx.auraLog.create({
          data: {
            amount: -BOOKMARK_RECEIVED_AURA,
            issuerId: user.id,
            postId,
            type: "POST_BOOKMARK_RECEIVED",
            userId: post.userId,
          },
        });
      }
    }
  });

  return Response.json({ success: true });
}
