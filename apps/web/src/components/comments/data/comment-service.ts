import { createCommentSchema } from "@asm/auth/validation";
import {
  and,
  applyFlatAward,
  applyWeightedAward,
  cancelMediaCleanup,
  COMMENT_CREATION_AURA,
  COMMENT_RECEIVED_AURA,
  findVisiblePost,
  getCommentDataQuery,
  fromPrismaDateTime,
  invalidateAuraSignals,
  mapCommentData,
  prisma,
  publishCommentCreated,
  publishCommentDeleted,
  reverseExactAura,
} from "@asm/db";
import type { CommentData } from "@asm/db";
import { CLAIMABLE_STATUSES } from "@asm/media";
import { updateTag } from "next/cache";

import {
  flushNotificationEvents,
  newNotificationEvents,
} from "@/lib/notifications/deferred-events";

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

  // Visibility-gated: a stranger must not be able to comment into a thread
  // inside a PRIVATE community they cannot read. findVisiblePost answers null
  // for both "missing" and "not readable", so the error cannot confirm that
  // the post exists.
  const post = await findVisiblePost(params.postId, params.userId);

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
    parent = await prisma.orm.public.Comments.select(
      "id",
      "postId",
      "rootId",
      "userId"
    )
      .where({ id: parentId })
      .first();

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

  // Award amounts survive the transaction for post-commit signal refresh.
  let creationAmount = 0;
  let receivedAmount = 0;
  let postReceivedAmount = 0;

  const notificationEvents = newNotificationEvents();
  const comment = await prisma.transaction(async (tx) => {
    // Eddies carry images and GIFs only, uploaded by the commenter. A crafted
    // request could attach another user's media, a video, or a stale id, so
    // verify every requested id is owned by the caller and is a raster image,
    // and that the returned set exactly matches what was asked for.
    if (mediaIdsValidated.length > 0) {
      const attachedMedia = await tx.orm.public.PostMedia.select(
        "commentId",
        "id",
        "messageConversationId",
        "mimeType",
        "postId",
        "status",
        "_type",
        "userId"
      )
        .where((candidate) => candidate.id.in(mediaIdsValidated))
        .all();
      const foundIds = new Set(attachedMedia.map((m) => m.id));
      const allFound = mediaIdsValidated.every((id) => foundIds.has(id));
      if (!allFound || attachedMedia.length !== mediaIdsValidated.length) {
        throw new Error("Eddies support images and GIFs only");
      }
      const disallowed = attachedMedia.some(
        (media) =>
          media._type === "VIDEO" ||
          !media.mimeType.startsWith("image/") ||
          media.mimeType === "image/svg+xml" ||
          media.userId !== params.userId ||
          media.commentId !== null ||
          media.postId !== null ||
          media.messageConversationId !== null ||
          // Rejected/failed/deleted uploads must never ride into a comment.
          !CLAIMABLE_STATUSES.includes(media.status)
      );
      if (disallowed) {
        throw new Error("Eddies support images and GIFs only");
      }
    }

    const createdBase = await tx.orm.public.Comments.select("id").create({
      content: contentValidated,
      parentId: parent?.id ?? null,
      postId: params.postId,
      rootId,
      userId: params.userId,
    });

    await Promise.all(
      mediaIdsValidated.map((mediaId) =>
        tx.orm.public.PostMedia.where({ id: mediaId }).update({
          commentId: createdBase.id,
        })
      )
    );

    const createdRow = await getCommentDataQuery(tx.orm, params.userId)
      .where({ id: createdBase.id })
      .first();
    if (!createdRow) {
      throw new Error("Created comment not found");
    }
    const created = mapCommentData(createdRow);

    // Commenter's participation stipend: flat (not credibility-weighted, so
    // earning never entrenches), but under the daily income cap.
    const commenter = await tx.orm.public.Users.select("aura", "createdAt")
      .where({ id: params.userId })
      .first();

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
        actor: {
          aura: commenter.aura,
          createdAt: fromPrismaDateTime(commenter.createdAt),
        },
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

    // Thread-cumulative award: a REPLY also pays the POST author (+1 per
    // eddie anywhere in their thread), so deep conversations keep earning
    // for the person who started them. Skipped when the post author is the
    // commenter or already paid as the primary recipient - one person is
    // paid once per eddie.
    const isReply = Boolean(parent);
    const postAuthorAlsoPaid =
      isReply &&
      post.userId !== params.userId &&
      post.userId !== receivedRecipientId;

    if (postAuthorAlsoPaid && commenter) {
      const postAward = await applyWeightedAward(tx, {
        actor: {
          aura: commenter.aura,
          createdAt: fromPrismaDateTime(commenter.createdAt),
        },
        actorId: params.userId,
        baseAmount: COMMENT_RECEIVED_AURA,
        commentId: created.id,
        now: new Date(),
        postId: params.postId,
        recipientId: post.userId,
        subjectToDailyCap: true,
        taperClass: "commentReceived",
        type: "COMMENT_RECEIVED",
      });
      postReceivedAmount = postAward.amount;
    }

    if (
      creationAmount !== 0 ||
      receivedAmount !== 0 ||
      postReceivedAmount !== 0
    ) {
      await tx.orm.public.Comments.where({ id: created.id }).update({
        creationAura: creationAmount,
        postReceivedAura: postReceivedAmount,
        receivedAura: receivedAmount,
      });
    }

    // Notifications are independent of aura: a zero-weighted award must not
    // silence them. The gate is the recipient set itself so self-replies
    // still notify the post author when one exists.
    if (notificationRecipientIds.size > 0) {
      await Promise.all(
        [...notificationRecipientIds].map(async (recipientId) => {
          const commentNotification = await tx.orm.public.Notifications.select(
            "id"
          ).create({
            _type: "COMMENT",
            commentId: created.id,
            issuerId: params.userId,
            postId: params.postId,
            recipientId,
          });

          notificationEvents.created.push({
            notificationId: commentNotification.id,
            recipientId,
          });
        })
      );
    }

    return created;
  });
  // Committed: now the worker can see the rows it is told about.
  flushNotificationEvents(notificationEvents, "eddie");

  // Fire-and-forget signal refresh; TTL is the correctness backstop. The
  // thread-cumulative award moves the post author's signals too.
  const signalUserIds = new Set([params.userId]);
  if (receivedRecipientId) {
    signalUserIds.add(receivedRecipientId);
  }
  if (postReceivedAmount !== 0) {
    signalUserIds.add(post.userId);
  }
  try {
    await invalidateAuraSignals([...signalUserIds]);
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
  const comment = await prisma.orm.public.Comments.select(
    "creationAura",
    "id",
    "parentId",
    "postId",
    "postReceivedAura",
    "receivedAura",
    "userId"
  )
    .where({ id: commentId })
    .first();

  if (!comment) {
    throw new Error("Comment not found");
  }

  if (comment.userId !== userId) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.orm.public.Posts.select("id", "userId")
    .where({ id: comment.postId })
    .first();

  if (!post) {
    throw new Error("Post not found");
  }

  // Deleting reverses exactly the stored open positions. Legacy comments
  // (created before the economy shipped) carry zeros and reverse nothing -
  // conservative under-refund by design.
  let affectedAuthorIds: string[] = [];
  if (
    comment.creationAura !== 0 ||
    comment.receivedAura !== 0 ||
    comment.postReceivedAura !== 0
  ) {
    affectedAuthorIds = [comment.userId];
  }

  const deleteEvents = newNotificationEvents();
  const deletedComment = await prisma.transaction(async (tx) => {
    await tx.orm.public.Comments.where({ id: commentId }).update({
      content: "",
      deleted: true,
    });
    const softDeletedRow = await getCommentDataQuery(tx.orm, userId)
      .where({ id: commentId })
      .first();
    if (!softDeletedRow) {
      throw new Error("Comment not found after deletion");
    }
    const softDeleted = mapCommentData(softDeletedRow);

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
      // Primary recipient is deterministic from thread shape: the parent
      // comment's author for a reply, else the post author - mirroring
      // exactly who createComment paid.
      let primaryRecipient = post.userId;
      if (comment.parentId) {
        const parent = await tx.orm.public.Comments.select("userId")
          .where({ id: comment.parentId })
          .first();
        if (parent) {
          primaryRecipient = parent.userId;
        }
      }

      await reverseExactAura(tx, {
        commentId,
        issuerId: comment.userId,
        openAmount: comment.receivedAura,
        postId: comment.postId,
        recipientId: primaryRecipient,
        targetUserId: primaryRecipient,
        type: "COMMENT_RECEIVED",
      });
      if (!affectedAuthorIds.includes(primaryRecipient)) {
        affectedAuthorIds.push(primaryRecipient);
      }
    }

    if (comment.postReceivedAura !== 0 && post.userId !== userId) {
      // The thread-cumulative award always belonged to the post author.
      await reverseExactAura(tx, {
        commentId,
        issuerId: comment.userId,
        openAmount: comment.postReceivedAura,
        postId: comment.postId,
        recipientId: post.userId,
        targetUserId: post.userId,
        type: "COMMENT_RECEIVED",
      });
      if (!affectedAuthorIds.includes(post.userId)) {
        affectedAuthorIds.push(post.userId);
      }
    }

    // The notifications that reference the deleted comment (eddies on the post,
    // replies to it, and eddie amplifies) all point at content that no longer
    // exists, so clean them up for every recipient whether or not aura was
    // ever awarded.
    const commentNotifications = await tx.orm.public.Notifications.select(
      "recipientId"
    )
      .where((notification) =>
        and(
          notification.commentId.eq(commentId),
          notification._type.in(["COMMENT", "AMPLIFY"])
        )
      )
      .all();
    await tx.orm.public.Notifications.where((notification) =>
      and(
        notification.commentId.eq(commentId),
        notification._type.in(["COMMENT", "AMPLIFY"])
      )
    ).delete();
    const notificationRecipientIds = [
      ...new Set(commentNotifications.map((n) => n.recipientId)),
    ];
    deleteEvents.deleted.push(...notificationRecipientIds);

    return softDeleted;
  });
  flushNotificationEvents(deleteEvents, "eddie");

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
