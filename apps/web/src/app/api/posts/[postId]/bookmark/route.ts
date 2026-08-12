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
          userId: loggedInUser.id,
          postId,
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
    where: { id: postId },
    select: { id: true, userId: true },
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
        userId_postId: { userId: user.id, postId },
      },
    });

    if (existingBookmark) {
      return;
    }

    await tx.bookmark.create({ data: { userId: user.id, postId } });

    if (!isSelfBookmark) {
      await tx.user.update({
        where: { id: user.id },
        data: { aura: { increment: BOOKMARKED_AURA } },
      });

      await tx.auraLog.create({
        data: {
          userId: user.id,
          issuerId: user.id,
          amount: BOOKMARKED_AURA,
          type: "POST_BOOKMARKED",
          postId,
        },
      });

      await tx.user.update({
        where: { id: post.userId },
        data: { aura: { increment: BOOKMARK_RECEIVED_AURA } },
      });

      await tx.auraLog.create({
        data: {
          userId: post.userId,
          issuerId: user.id,
          amount: BOOKMARK_RECEIVED_AURA,
          type: "POST_BOOKMARK_RECEIVED",
          postId,
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
    where: { id: postId },
    select: { id: true, userId: true },
  });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const isSelfBookmark = post.userId === user.id;

  await prisma.$transaction(async (tx) => {
    const existingBookmark = await tx.bookmark.findUnique({
      where: {
        userId_postId: { userId: user.id, postId },
      },
    });

    // Only reverse aura when the bookmark actually existed and was awarded
    // (bookmarks created before this feature shipped never earned it).
    if (!existingBookmark) {
      return;
    }

    await tx.bookmark.deleteMany({ where: { userId: user.id, postId } });

    if (!isSelfBookmark) {
      const wasAwarded = await tx.auraLog.findFirst({
        where: {
          userId: user.id,
          type: "POST_BOOKMARKED",
          postId,
        },
      });

      if (wasAwarded) {
        await tx.user.update({
          where: { id: user.id },
          data: { aura: { decrement: BOOKMARKED_AURA } },
        });

        await tx.auraLog.create({
          data: {
            userId: user.id,
            issuerId: user.id,
            amount: -BOOKMARKED_AURA,
            type: "POST_BOOKMARKED",
            postId,
          },
        });

        await tx.user.update({
          where: { id: post.userId },
          data: { aura: { decrement: BOOKMARK_RECEIVED_AURA } },
        });

        await tx.auraLog.create({
          data: {
            userId: post.userId,
            issuerId: user.id,
            amount: -BOOKMARK_RECEIVED_AURA,
            type: "POST_BOOKMARK_RECEIVED",
            postId,
          },
        });
      }
    }
  });

  return Response.json({ success: true });
}
