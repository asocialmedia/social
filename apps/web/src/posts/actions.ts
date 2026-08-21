"use server";

import {
  enqueuePostDeleted,
  getPostDataInclude,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
  unreadNotificationCache,
} from "@asm/db";
import type { PostData } from "@asm/db";
import { updateTag } from "next/cache";

import { getSessionFromApi } from "@/lib/session";
import { getModerationSystemUserId } from "@/lib/system-moderation-user";

export interface PostModerationChanges {
  explicitContent?: boolean;
  moderated?: boolean;
}

// Aura docked from the author the first time their post is marked as
// moderated. The penalty is one-way: unmoderating restores the content but
// never refunds the aura.
const MODERATION_AURA_PENALTY = 100;

// Admins can moderate any post; the author can flag their own. Both flags are
// reversible - a moderated post stays in the DB and can be restored, and the
// explicit gate can be lifted - so this is an update, never a delete. Marking a
// post as moderated also docks the author's aura (one-way) and notifies them.
export async function updatePostModeration(
  id: string,
  changes: PostModerationChanges
) {
  const session = await getSessionFromApi();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    select: { explicitContent: true, id: true, moderated: true, userId: true },
    where: { id },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  const isOwner = post.userId === session.user.id;
  const isAdmin = session.user.role === "admin";
  if (!isOwner && !isAdmin) {
    throw new Error("Unauthorized");
  }

  // Only the two moderation flags may ever be written by this action. Build a
  // fresh object from the known fields so stray/unknown client properties
  // (content, userId, aura, counters, isGust, ...) can never reach Prisma.
  const data: { explicitContent?: boolean; moderated?: boolean } = {};
  if (changes.explicitContent !== undefined) {
    data.explicitContent = changes.explicitContent;
  }
  if (changes.moderated !== undefined) {
    data.moderated = changes.moderated;
  }

  // Transitions derived from the pre-transaction state. The moderated penalty
  // and notification use `confirmedModeratedTransition` (set inside the
  // transaction) so concurrent requests cannot double-apply them.
  const justUnmoderated = data.moderated === false && post.moderated;
  const justFlaggedExplicit =
    data.explicitContent === true && !post.explicitContent;
  const justUnflaggedExplicit =
    data.explicitContent === false && post.explicitContent;

  // Resolve the neutral system user once, before the transaction, so the
  // callback never performs redundant I/O.
  const systemUserId = await getModerationSystemUserId();

  let confirmedModeratedTransition = false;
  const updated = await prisma.$transaction(async (tx) => {
    let result: PostData | null;

    if (data.moderated === true) {
      // Atomic: only the caller that actually flips moderated false->true is
      // charged. Concurrent requests race on this single conditional update.
      const flip = await tx.post.updateMany({
        data,
        where: { id, moderated: false },
      });
      confirmedModeratedTransition = flip.count === 1;
      // The post was already moderated (or a concurrent request won the race):
      // apply only an accompanying explicit flag so it still lands.
      if (flip.count === 0 && data.explicitContent !== undefined) {
        await tx.post.update({
          data: { explicitContent: data.explicitContent },
          where: { id },
        });
      }
      result = await tx.post.findUnique({
        include: getPostDataInclude(session.user.id),
        where: { id },
      });
    } else {
      result = await tx.post.update({
        data,
        include: getPostDataInclude(session.user.id),
        where: { id },
      });
    }

    if (!result) {
      throw new Error("Post not found");
    }

    // The moderation aura penalty is applied exactly once, on the transactionally
    // confirmed false->true transition. Unmoderating never refunds it.
    if (confirmedModeratedTransition) {
      await tx.user.update({
        data: { aura: { increment: -MODERATION_AURA_PENALTY } },
        where: { id: post.userId },
      });
      await tx.auraLog.create({
        data: {
          amount: -MODERATION_AURA_PENALTY,
          issuerId: session.user.id,
          postId: id,
          type: "MODERATION_PENALTY",
          userId: post.userId,
        },
      });
    }

    // Notify the author on every flag change. The notification is issued by
    // the neutral "Zeph" system account so the moderator stays anonymous - even
    // for self-moderation, so the author sees the moderation in their bell.
    if (
      confirmedModeratedTransition ||
      justUnmoderated ||
      justFlaggedExplicit ||
      justUnflaggedExplicit
    ) {
      await tx.notification.create({
        data: {
          issuerId: systemUserId,
          postId: id,
          recipientId: post.userId,
          type: "MODERATION",
        },
      });
    }

    return result;
  });

  // Bump the unread-bell counter synchronously (not via the worker) so the
  // count is correct the instant the mutation resolves and the sidebar/header
  // badge can refresh immediately instead of waiting on the 60s poll.
  if (
    confirmedModeratedTransition ||
    justUnmoderated ||
    justFlaggedExplicit ||
    justUnflaggedExplicit
  ) {
    try {
      await unreadNotificationCache.increment(post.userId);
    } catch (error) {
      console.error("Failed to increment unread notification count:", error);
    }
  }

  // Expire the cached OG card + media rows so the moderation state is reflected
  // on share cards and media pages (read-your-own-writes).
  updateTag("og-post-card");
  updateTag("media-row");

  return updated;
}

export async function deletePost(id: string) {
  const session = await getSessionFromApi();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    where: { id },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  if (post.userId !== session.user.id) {
    throw new Error("Unauthorized");
  }

  const deletedPost = await prisma.post.delete({
    include: getPostDataInclude(session.user.id),
    where: { id },
  });

  try {
    await Promise.all([
      redis.srem(POST_VIEWS_SET, id),
      redis.del(`${POST_VIEWS_KEY_PREFIX}${id}`),
    ]);
  } catch (error) {
    console.error("Error cleaning up Redis cache for deleted post:", error);
  }

  // The worker deletes the post's media objects + rows (fixes the orphaned
  // media leak caused by the SetNull FK).
  try {
    await enqueuePostDeleted(id);
  } catch (error) {
    console.error("Failed to enqueue post-deleted event:", error);
  }

  // Expire the cached OG card + media rows immediately so a deleted post's
  // share card and media URLs stop being served (read-your-own-writes).
  updateTag("og-post-card");
  updateTag("media-row");

  return deletedPost;
}
