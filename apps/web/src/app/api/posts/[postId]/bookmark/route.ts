import {
  applyFlatAward,
  applyWeightedAward,
  BOOKMARK_GIVEN_AURA,
  BOOKMARK_RECEIVED_AURA,
  invalidateAuraSignals,
  prisma,
  reverseExactAura,
} from "@asm/db";
import type { BookmarkInfo } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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
  let affectedAuthorId: string | null = null;

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

    if (isSelfBookmark) {
      await tx.bookmark.create({ data: { postId, userId: user.id } });
    } else {
      affectedAuthorId = post.userId;

      // Curation credit for the bookmarker: flat stipend under the daily cap.
      const { amount: givenAmount } = await applyFlatAward(tx, {
        actorId: user.id,
        baseAmount: BOOKMARK_GIVEN_AURA,
        now: new Date(),
        postId,
        recipientId: user.id,
        subjectToDailyCap: true,
        type: "POST_BOOKMARKED",
      });

      // Recognition for the creator: weighted by the bookmarker's
      // credibility - the strongest deliberate signal, priced above an
      // amplify, tapered per pair like every engagement class.
      const actor = await tx.user.findUnique({
        select: { aura: true, createdAt: true },
        where: { id: user.id },
      });
      let receivedAmount = 0;
      if (actor) {
        const awarded = await applyWeightedAward(tx, {
          actor: { aura: actor.aura, createdAt: actor.createdAt },
          actorId: user.id,
          baseAmount: BOOKMARK_RECEIVED_AURA,
          now: new Date(),
          postId,
          recipientId: post.userId,
          subjectToDailyCap: true,
          taperClass: "bookmark",
          type: "POST_BOOKMARK_RECEIVED",
        });
        receivedAmount = awarded.amount;
      }

      await tx.bookmark.create({
        data: {
          authorAura: receivedAmount,
          bookmarkerAura: givenAmount,
          postId,
          userId: user.id,
        },
      });
    }
  });

  if (affectedAuthorId) {
    try {
      await invalidateAuraSignals([affectedAuthorId, user.id]);
    } catch (error) {
      console.error("Failed to invalidate aura signals:", error);
    }
  }

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
    // Read the stored open positions before the authoritative delete: the
    // deleteMany count decides WHO performed the logical unbookmark, and the
    // stored positions say exactly how much to unwind. Legacy bookmarks
    // (created before the economy shipped) carry zeros and reverse nothing -
    // conservative by design.
    const bookmark = await tx.bookmark.findUnique({
      select: { authorAura: true, bookmarkerAura: true },
      where: { userId_postId: { postId, userId: user.id } },
    });

    // The delete itself is the gate: under READ COMMITTED two concurrent
    // unbookmarks can both observe the row as present, but only the
    // transaction whose deleteMany removes exactly one row performed the
    // logical unbookmark and may reverse aura.
    const { count } = await tx.bookmark.deleteMany({
      where: { postId, userId: user.id },
    });

    if (count !== 1 || !bookmark || isSelfBookmark) {
      return;
    }

    if (bookmark.bookmarkerAura !== 0) {
      await reverseExactAura(tx, {
        issuerId: user.id,
        openAmount: bookmark.bookmarkerAura,
        postId,
        recipientId: user.id,
        targetUserId: user.id,
        type: "POST_BOOKMARKED",
      });
    }

    if (bookmark.authorAura !== 0) {
      await reverseExactAura(tx, {
        issuerId: user.id,
        openAmount: bookmark.authorAura,
        postId,
        recipientId: post.userId,
        targetUserId: post.userId,
        type: "POST_BOOKMARK_RECEIVED",
      });
    }
  });

  try {
    await invalidateAuraSignals([post.userId, user.id]);
  } catch (error) {
    console.error("Failed to invalidate aura signals:", error);
  }

  return Response.json({ success: true });
}
