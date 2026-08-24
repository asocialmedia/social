"use server";

import {
  applyModerationPenalty,
  enqueuePostDeleted,
  getPostDataInclude,
  invalidateAuraSignals,
  POST_VIEWS_KEY_PREFIX,
  POST_VIEWS_SET,
  prisma,
  redis,
  unreadNotificationCache,
} from "@asm/db";
import { updateTag } from "next/cache";

import { getSessionFromApi } from "@/lib/session";
import { getModerationSystemUserId } from "@/lib/system-moderation-user";

export interface PostModerationChanges {
  explicitContent?: boolean;
  moderated?: boolean;
}

// Aura docked from the author the first time their post is marked as
// moderated, applied through the ledger (applyModerationPenalty). The penalty
// is one-way: unmoderating restores the content but never refunds the aura.

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

  // Resolve the neutral system user once, before the transaction, so the
  // callback never performs redundant I/O.
  const systemUserId = await getModerationSystemUserId();

  // Each transition is confirmed by a conditional affected-row count inside the
  // transaction, so concurrent requests can never double-apply a transition
  // (two sessions unmoderating, or applying the same explicit flag, both derive
  // the stale pre-transaction state). Only the request whose conditional update
  // actually matched a row notifies and increments the unread counter.
  let confirmedModerated = false; // false -> true
  let confirmedUnmoderated = false; // true -> false
  let confirmedFlaggedExplicit = false; // false -> true
  let confirmedUnflaggedExplicit = false; // true -> false

  const updated = await prisma.$transaction(async (tx) => {
    // Moderated transition: conditional on the current DB value.
    if (data.moderated !== undefined) {
      const flip = await tx.post.updateMany({
        data: { moderated: data.moderated },
        where: { id, moderated: !data.moderated },
      });
      if (data.moderated) {
        confirmedModerated = flip.count === 1;
      } else {
        confirmedUnmoderated = flip.count === 1;
      }
    }

    // Explicit-content transition: conditional on the current DB value.
    if (data.explicitContent !== undefined) {
      const flip = await tx.post.updateMany({
        data: { explicitContent: data.explicitContent },
        where: {
          explicitContent: !data.explicitContent,
          id,
        },
      });
      if (data.explicitContent) {
        confirmedFlaggedExplicit = flip.count === 1;
      } else {
        confirmedUnflaggedExplicit = flip.count === 1;
      }
    }

    const result = await tx.post.findUnique({
      include: getPostDataInclude(session.user.id),
      where: { id },
    });

    if (!result) {
      throw new Error("Post not found");
    }

    // The moderation aura penalty is applied exactly once, on the transactionally
    // confirmed false->true transition, through the audited ledger writer.
    // Unmoderating never refunds it.
    if (confirmedModerated) {
      await applyModerationPenalty(tx, {
        actorId: session.user.id,
        postId: id,
        recipientId: post.userId,
      });
    }

    // Notify the author on every confirmed flag change. The notification is
    // issued by the neutral "Zeph" system account so the moderator stays
    // anonymous - even for self-moderation, so the author sees the moderation
    // in their bell.
    if (
      confirmedModerated ||
      confirmedUnmoderated ||
      confirmedFlaggedExplicit ||
      confirmedUnflaggedExplicit
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
    confirmedModerated ||
    confirmedUnmoderated ||
    confirmedFlaggedExplicit ||
    confirmedUnflaggedExplicit
  ) {
    try {
      await unreadNotificationCache.increment(post.userId);
    } catch (error) {
      console.error("Failed to increment unread notification count:", error);
    }
  }

  if (confirmedModerated) {
    // Signal refresh after commit; failures only cost cache freshness.
    try {
      await invalidateAuraSignals([post.userId]);
    } catch (error) {
      console.error("Failed to invalidate aura signals:", error);
    }
  }

  // Expire the cached OG card + media rows so the moderation state is reflected
  // on share cards and media pages (read-your-own-writes).
  updateTag("og-post-card");
  updateTag("media-object");

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
  updateTag("media-object");

  return deletedPost;
}
