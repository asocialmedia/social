import { createCommentSchema } from "@asm/auth/validation";
import {
  applyFlatAward,
  applyWeightedAward,
  cancelMediaCleanup,
  COMMENT_CREATION_AURA,
  COMMENT_RECEIVED_AURA,
  enqueueNotificationCreated,
  enqueueNotificationDeleted,
  getCommentDataInclude,
  invalidateAuraSignals,
  prisma,
  publishCommentCreated,
  publishCommentDeleted,
  reverseExactAura,
} from "@asm/db";
import type { CommentData } from "@asm/db";
import { updateTag } from "next/cache";

// Deleting a comment with replies would orphan the tree, so deletes are soft:
// the row stays (so the thread structure survives) but the content is blanked
// and it renders as removed. Hard deletes only happen for comment rows created
// before nesting existed, which never have children.
export interface CreateCommentParams {
  content: string;
  mediaIds?: string[];
  parentId?: string;
  postId: string;
  userId: string;
}

export async function createComment(
  params: CreateCommentParams
): Promise<CommentData> {
  const {
    content: contentValidated,
    mediaIds: mediaIdsValidated,
    parentId,
  } = createCommentSchema.parse({
    content: params.content,
    mediaIds: params.mediaIds ?? [],
    parentId: params.parentId,
  });

  const post = await prisma.post.findUnique({
    select: { id: true, userId: true },
    where: { id: params.postId },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  let parent: {
    id: string;
    postId: string;
    rootId: string | null;
    userId: string;
  } | null = null;

  if (parentId) {
    parent = await prisma.comment.findUnique({
      select: { id: true, postId: true, rootId: true, userId: true },
      where: { id: parentId },
    });

    if (!parent) {
      throw new Error("Parent comment not found");
    }

    if (parent.postId !== params.postId) {
      throw new Error("Parent comment does not belong to this post");
    }
  }

  const rootId = parent ? (parent.rootId ?? parent.id) : null;

  const isSelfPost = post.userId === params.userId;
  let receivedRecipientId: string | null = null;
  if (parent) {
    receivedRecipientId =
      parent.userId === params.userId ? null : parent.userId;
  } else if (!isSelfPost) {
    receivedRecipientId = post.userId;
  }

  // Everyone who gets a notification for this comment. The parent comment's
  // author is notified on a reply, and the post author is also notified when a
  // thread on their post gets a reply (unless they're the same person or the
  // commenter).
  const notificationRecipientIds = new Set<string>();
  if (parent) {
    if (parent.userId !== params.userId) {
      notificationRecipientIds.add(parent.userId);
    }
    if (post.userId !== params.userId && post.userId !== parent.userId) {
      notificationRecipientIds.add(post.userId);
    }
  } else if (!isSelfPost) {
    notificationRecipientIds.add(post.userId);
  }

  const comment = await prisma.$transaction(async (tx) => {
    // Eddies carry images and GIFs only, uploaded by the commenter. A crafted
    // request could attach another user's media, a video, or a stale id, so
    // verify every requested id is owned by the caller and is a raster image,
    // and that the returned set exactly matches what was asked for.
    if (mediaIdsValidated.length > 0) {
      const attachedMedia = await tx.media.findMany({
        select: { id: true, mimeType: true, type: true, userId: true },
        where: { id: { in: mediaIdsValidated } },
      });
      const foundIds = new Set(attachedMedia.map((m) => m.id));
      const allFound = mediaIdsValidated.every((id) => foundIds.has(id));
      if (!allFound || attachedMedia.length !== mediaIdsValidated.length) {
        throw new Error("Eddies support images and GIFs only");
      }
      const disallowed = attachedMedia.some(
        (media) =>
          media.type === "VIDEO" ||
          !media.mimeType.startsWith("image/") ||
          media.mimeType === "image/svg+xml" ||
          (media.userId !== null && media.userId !== params.userId)
      );
      if (disallowed) {
        throw new Error("Eddies support images and GIFs only");
      }
    }

    const created = await tx.comment.create({
      data: {
        attachments: mediaIdsValidated.length
          ? { connect: mediaIdsValidated.map((id) => ({ id })) }
          : undefined,
        content: contentValidated,
        parentId: parent?.id,
        postId: params.postId,
        rootId,
        userId: params.userId,
      },
      include: getCommentDataInclude(params.userId),
    });

    // Commenter's participation stipend: flat (not credibility-weighted, so
    // earning never entrenches), but under the daily income cap.
    const commenter = await tx.user.findUnique({
      select: { aura: true, createdAt: true },
      where: { id: params.userId },
    });
    let creationAmount = 0;
    let receivedAmount = 0;

    if (commenter) {
      const creationAward = await applyFlatAward(tx, {
        actorId: params.userId,
        baseAmount: COMMENT_CREATION_AURA,
        commentId: created.id,
        now: new Date(),
        postId: params.postId,
        recipientId: params.userId,
        subjectToDailyCap: true,
        type: "COMMENT_CREATION",
      });
      creationAmount = creationAward.amount;
    }

    // Receiving a thoughtful reply is engagement: weighted by the
    // commenter's credibility and tapered per pair.
    if (receivedRecipientId && commenter) {
      const receivedAward = await applyWeightedAward(tx, {
        actor: { aura: commenter.aura, createdAt: commenter.createdAt },
        actorId: params.userId,
        baseAmount: COMMENT_RECEIVED_AURA,
        commentId: created.id,
        now: new Date(),
        postId: params.postId,
        recipientId: receivedRecipientId,
        subjectToDailyCap: true,
        taperClass: "commentReceived",
        type: "COMMENT_RECEIVED",
      });
      receivedAmount = receivedAward.amount;
    }

    if (creationAmount !== 0 || receivedAmount !== 0) {
      await tx.comment.update({
        data: { creationAura: creationAmount, receivedAura: receivedAmount },
        where: { id: created.id },
      });
    }

    // Notifications are independent of aura: a zero-weighted award must not
    // silence them.
    if (receivedRecipientId) {
      await Promise.all(
        [...notificationRecipientIds].map(async (recipientId) => {
          await tx.notification.create({
            data: {
              commentId: created.id,
              issuerId: params.userId,
              postId: params.postId,
              recipientId,
              type: "COMMENT",
            },
          });

          enqueueNotificationCreated(recipientId).catch((error: unknown) => {
            console.error(
              "Failed to enqueue notification created event:",
              error
            );
          });
        })
      );
    }

    return created;
  });

  // Fire-and-forget signal refresh; TTL is the correctness backstop.
  const signalUserIds = [params.userId];
  if (receivedRecipientId) {
    signalUserIds.push(receivedRecipientId);
  }
  try {
    await invalidateAuraSignals(signalUserIds);
  } catch (error) {
    console.error("Failed to invalidate aura signals:", error);
  }

  // The media is now attached to a comment, so the abandoned-upload cleanup
  // jobs must not delete it.
  await Promise.allSettled(
    mediaIdsValidated.map(async (mediaId) => {
      try {
        await cancelMediaCleanup(mediaId);
      } catch (error) {
        console.error(`Failed to cancel media cleanup for ${mediaId}:`, error);
      }
    })
  );

  // The media rows' commentId just changed, and /api/media caches the row to
  // drive its access decision. Drop that cache so the updated ownership is
  // picked up instead of serving a stale row for up to an hour.
  if (mediaIdsValidated.length > 0) {
    updateTag("media-object");
  }

  try {
    await publishCommentCreated(params.postId, comment);
  } catch (error) {
    console.error("Failed to publish comment created event:", error);
  }

  return comment;
}

export async function softDeleteComment(
  commentId: string,
  userId: string
): Promise<CommentData> {
  const comment = await prisma.comment.findUnique({
    select: {
      creationAura: true,
      id: true,
      parentId: true,
      postId: true,
      receivedAura: true,
      userId: true,
    },
    where: { id: commentId },
  });

  if (!comment) {
    throw new Error("Comment not found");
  }

  if (comment.userId !== userId) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    select: { id: true, userId: true },
    where: { id: comment.postId },
  });

  if (!post) {
    throw new Error("Post not found");
  }

  // Deleting reverses exactly the stored open positions. Legacy comments
  // (created before the economy shipped) carry zeros and reverse nothing -
  // conservative under-refund by design.
  let affectedAuthorIds: string[] = [];
  if (comment.creationAura !== 0 || comment.receivedAura !== 0) {
    affectedAuthorIds = [comment.userId];
  }

  const deletedComment = await prisma.$transaction(async (tx) => {
    const softDeleted = await tx.comment.update({
      data: { content: "", deleted: true },
      include: getCommentDataInclude(userId),
      where: { id: commentId },
    });

    if (comment.creationAura !== 0) {
      await reverseExactAura(tx, {
        commentId,
        issuerId: comment.userId,
        openAmount: comment.creationAura,
        postId: comment.postId,
        recipientId: comment.userId,
        targetUserId: comment.userId,
        type: "COMMENT_CREATION",
      });
    }

    if (comment.receivedAura !== 0) {
      // The recipient was whoever the COMMENT_RECEIVED ledger row paid when
      // the comment was created; the ledger, not a recomputation, stays the
      // source of truth.
      const receivedRow = await tx.auraLog.findFirst({
        orderBy: { createdAt: "desc" },
        where: {
          commentId,
          targetUserId: { not: null },
          type: "COMMENT_RECEIVED",
        },
      });

      if (receivedRow) {
        await reverseExactAura(tx, {
          commentId,
          issuerId: comment.userId,
          openAmount: comment.receivedAura,
          postId: comment.postId,
          recipientId: receivedRow.targetUserId ?? receivedRow.userId,
          targetUserId: receivedRow.targetUserId ?? receivedRow.userId,
          type: "COMMENT_RECEIVED",
        });
        if (
          receivedRow.targetUserId &&
          !affectedAuthorIds.includes(receivedRow.targetUserId)
        ) {
          affectedAuthorIds.push(receivedRow.targetUserId);
        }
      }
    }

    // The notifications that reference the deleted comment (eddies on the post,
    // replies to it, and eddie amplifies) all point at content that no longer
    // exists, so clean them up for every recipient whether or not aura was
    // ever awarded.
    const commentNotifications = await tx.notification.findMany({
      select: { recipientId: true },
      where: { commentId, type: { in: ["COMMENT", "AMPLIFY"] } },
    });
    await tx.notification.deleteMany({
      where: { commentId, type: { in: ["COMMENT", "AMPLIFY"] } },
    });
    const notificationRecipientIds = [
      ...new Set(commentNotifications.map((n) => n.recipientId)),
    ];
    await Promise.allSettled(
      notificationRecipientIds.map((recipientId) =>
        enqueueNotificationDeleted(recipientId).catch((error: unknown) => {
          console.error("Failed to enqueue notification deleted event:", error);
        })
      )
    );

    return softDeleted;
  });

  if (affectedAuthorIds.length > 0) {
    try {
      await invalidateAuraSignals([...new Set(affectedAuthorIds)]);
    } catch (error) {
      console.error("Failed to invalidate aura signals:", error);
    }
  }

  try {
    await publishCommentDeleted(comment.postId, deletedComment);
  } catch (error) {
    console.error("Failed to publish comment deleted event:", error);
  }

  return deletedComment;
}
