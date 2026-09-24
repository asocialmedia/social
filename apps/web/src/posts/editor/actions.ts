"use server";

import type { CreatePostInput } from "@asm/auth/validation";
import { createGustSchema, createPostSchema } from "@asm/auth/validation";
import {
  and,
  applyFlatAward,
  ATTACHMENT_BONUSES,
  cancelMediaCleanup,
  COMMENT_RECEIVED_AURA,
  enqueueMediaAnalyze,
  enqueueNotificationCreated,
  enqueueShitposterCheck,
  generateLocalEmbedding,
  getPostDataQuery,
  HN_SHARE_BONUS_AURA,
  invalidateAuraSignals,
  invalidateCommunityPostAggregates,
  invalidateCommunityStats,
  invalidateFypProfile,
  MENTION_RECEIVED_AURA,
  mapPostData,
  notifyCommunitySubscribers,
  POST_CREATION_AURA,
  POST_CREATION_MAX_AURA,
  postViewsCache,
  prisma,
  publishResponseCreated,
  RESPONSE_RECEIVED_AURA,
  RESPONSE_RECEIVED_POST_AURA,
  schedulePublishedNotificationCleanup,
  tagCache,
} from "@asm/db";
import type { PrismaTransaction } from "@asm/db";
import { CLAIMABLE_STATUSES, MAX_POST_ATTACHMENTS } from "@asm/media";
import { siteConfig } from "@asm/ui/meta/site";
import { updateTag } from "next/cache";

import { resolvePostEmbeds } from "@/lib/link-embeds/server";
import { MAX_POST_EMBEDS } from "@/lib/link-embeds/shared";
import { getModerationSystemUserId } from "@/lib/moderation/system-moderation-user";
import {
  flushNotificationEvents,
  newNotificationEvents,
} from "@/lib/notifications/deferred-events";
import { getPostUrl } from "@/lib/seo/seo";

type ExtendedCreatePostInput = CreatePostInput & {
  hnStory?: {
    storyId: number;
    title: string;
    url?: string;
    by: string;
    time: number;
    score: number;
    descendants: number;
  };
};

// Creation rewards come from the aura economy config - the single tuning
// surface for every aura constant (see packages/db/src/aura/config.ts).
const AURA_REWARDS = {
  ATTACHMENTS: ATTACHMENT_BONUSES,
  BASE_POST: POST_CREATION_AURA,
  HN_SHARE: HN_SHARE_BONUS_AURA,
  MAX_TOTAL: POST_CREATION_MAX_AURA,
};
const MAX_CAS_ATTEMPTS = 8;

async function runSequentially<T>(
  values: readonly T[],
  operation: (value: T) => Promise<unknown>,
  index = 0
): Promise<void> {
  if (index >= values.length) {
    return;
  }
  const value = values[index] as T;
  await operation(value);
  return runSequentially(values, operation, index + 1);
}

async function updatePostAuraWithCas(
  tx: PrismaTransaction,
  postId: string,
  delta: number,
  attemptsRemaining = MAX_CAS_ATTEMPTS
): Promise<void> {
  const post = await tx.orm.public.Posts.select("aura")
    .where({ id: postId })
    .first();
  if (!post) {
    return;
  }
  const updated = await tx.orm.public.Posts.where((candidate) =>
    and(candidate.id.eq(postId), candidate.aura.eq(post.aura))
  ).updateAndCount({ aura: post.aura + delta });
  if (updated === 1) {
    return;
  }
  if (attemptsRemaining <= 1) {
    throw new Error("Could not update post aura");
  }
  return updatePostAuraWithCas(tx, postId, delta, attemptsRemaining - 1);
}

type AttachmentType = "IMAGE" | "VIDEO" | "AUDIO";

// Fire-and-forget wrapper so post creation never blocks on the badge check
// enqueue; failures are logged, never surfaced to the author.
async function enqueueShitposterCheckSafely(userId: string) {
  try {
    await enqueueShitposterCheck(userId);
  } catch (error) {
    console.error("Failed to enqueue shitposter check:", error);
  }
}

// Same fire-and-forget contract for the notification fan-out: a queue hiccup
// costs a stale badge/push, never the publish.
async function enqueueNotificationSafely(
  recipientId: string,
  notificationId?: string
) {
  try {
    await enqueueNotificationCreated(recipientId, notificationId);
  } catch (error) {
    console.error("Failed to enqueue notification created event:", error);
  }
}

async function calculateAuraReward(mediaIds: string[], hasHnStory: boolean) {
  let totalAura = hasHnStory
    ? AURA_REWARDS.BASE_POST + AURA_REWARDS.HN_SHARE
    : AURA_REWARDS.BASE_POST;

  if (!mediaIds.length) {
    return totalAura;
  }

  const mediaItems = await prisma.orm.public.PostMedia.select("id", "_type")
    .where((media) => media.id.in(mediaIds))
    .all();

  const typeCount: Record<AttachmentType, number> = {
    AUDIO: 0,
    IMAGE: 0,
    VIDEO: 0,
  };

  for (const item of mediaItems) {
    const type = item._type as AttachmentType;
    if (type in typeCount) {
      typeCount[type] += 1;
    }
  }

  for (const [type, count] of Object.entries(typeCount)) {
    if (count > 0) {
      const config = AURA_REWARDS.ATTACHMENTS[type as AttachmentType];
      const baseReward = config.base;
      const bonusReward = Math.min(count * config.perItem, config.max);
      totalAura += baseReward + bonusReward;
    }
  }

  return Math.min(totalAura, AURA_REWARDS.MAX_TOTAL);
}

export async function submitPost(input: ExtendedCreatePostInput) {
  try {
    console.log("Checking session for post submission...");
    const { getSessionFromApi } = await import("@/lib/auth/session");
    const sessionData = await getSessionFromApi();
    console.log("Session check:", {
      hasSession: !!sessionData,
      hasUser: !!sessionData?.user,
    });

    if (!sessionData?.user) {
      console.error("Session check failed - user not authenticated");
      throw new Error(
        "You are not logged in. Please log in again to submit your post."
      );
    }
    console.log("Session validated, proceeding with post submission");

    const isResponse = Boolean(input.parentPostId);
    // Responses are always fleets: a gust carries a single vertical video,
    // which has no thread meaning. A crafted isGust+parentPostId payload is
    // coerced to a fleet rather than trusted.
    const parsed = (
      input.isGust && !isResponse ? createGustSchema : createPostSchema
    ).parse({
      communityId: input.communityId,
      communitySharePostId: input.communitySharePostId,
      content: input.content,
      dismissedEmbedUrls: input.dismissedEmbedUrls ?? [],
      isGust: isResponse ? false : (input.isGust ?? false),
      mediaIds: input.mediaIds || [],
      mentions: input.mentions || [],
      parentPostId: input.parentPostId,
      tags: input.tags || [],
    });
    const validatedInput: CreatePostInput = parsed;

    // Community authorization is checked BEFORE the transaction: publishing
    // into a community requires an ACTIVE membership (owner/moderator/member),
    // and a reshare must point at a post that actually lives in a community.
    let communityId: string | null = null;
    if (validatedInput.communityId) {
      const community = await prisma.orm.public.Communities.select("id")
        .where({ id: validatedInput.communityId })
        .first();
      if (!community) {
        throw new Error("That community does not exist");
      }
      const membership = await prisma.orm.public.CommunityMembers.select(
        "status"
      )
        .where((member) =>
          and(
            member.communityId.eq(community.id),
            member.userId.eq(sessionData.user.id)
          )
        )
        .first();
      if (membership?.status !== "ACTIVE") {
        throw new Error("Join this community before posting in it");
      }
      communityId = community.id;
    }

    // A reshare must reference a real community post. The source's community
    // is captured so the side row stays correct even if the source is later
    // detached from the community.
    let communityShare: { communityId: string; sourcePostId: string } | null =
      null;
    if (validatedInput.communitySharePostId) {
      const source = await prisma.orm.public.Posts.select("communityId", "id")
        .where({ id: validatedInput.communitySharePostId })
        .first();
      if (!source?.communityId) {
        throw new Error("That post is not from a community");
      }
      communityShare = {
        communityId: source.communityId,
        sourcePostId: source.id,
      };
    }

    // Link embeds resolve before the transaction: cache-first (the composer
    // preview warmed Redis moments ago), bounded by a wall-clock budget so a
    // slow origin can never stall publishing. Dismissal is only honored for
    // URLs actually present in the content, so a crafted payload cannot
    // preload arbitrary cache entries.
    const dismissedEmbedUrls = new Set(
      (validatedInput.dismissedEmbedUrls ?? []).slice(0, MAX_POST_EMBEDS)
    );
    const embeds = validatedInput.content
      ? await resolvePostEmbeds(validatedInput.content, dismissedEmbedUrls)
      : [];
    // Prisma's Json input needs its own JSON value type; a round-trip gives
    // a plain, index-signature-shaped payload without any assertion on the
    // embed objects themselves.
    const embedsJson =
      embeds.length > 0
        ? embeds.map((embed) => ({
            description: embed.description ?? null,
            imageUrl: embed.imageUrl ?? null,
            siteName: embed.siteName ?? null,
            title: embed.title,
            type: embed.type,
            url: embed.url,
            videoAuthor: embed.videoAuthor ?? null,
            videoId: embed.videoId ?? null,
          }))
        : undefined;

    const auraReward = await calculateAuraReward(
      validatedInput.mediaIds,
      !!input.hnStory
    );

    let publishedNotificationId: string | undefined;
    // Subscribers who received a FRESH community-post notification row inside
    // the transaction. Only these need an unread-counter bump afterward; a row
    // that was folded in place was already unread.
    let communityNotifyNotifications: {
      id: string;
      recipientId: string;
    }[] = [];

    // Reply and mention notification events wait for the commit (see
    // lib/notifications/deferred-events.ts).
    const notificationEvents = newNotificationEvents();
    const newPost = await prisma.transaction(async (tx) => {
      // Server-side hard stop matching the composer's client cap: a crafted
      // request bypassing the UI must not publish more than the contract
      // allows.
      if (validatedInput.mediaIds.length > MAX_POST_ATTACHMENTS) {
        throw new Error(
          `A post can hold at most ${MAX_POST_ATTACHMENTS} attachments`
        );
      }
      // Attachments must be owned by the caller and unclaimed: a crafted
      // mediaId could otherwise drag another user's comment attachment (or an
      // owner-only draft) into a public post, and the post-deletion worker
      // would then permanently delete the victim's storage objects. Mirrors
      // the ownership validation the comment flow already applies.
      if (validatedInput.mediaIds.length > 0) {
        const attachedMedia = await tx.orm.public.PostMedia.select(
          "commentId",
          "id",
          "messageConversationId",
          "postId",
          "status",
          "userId"
        )
          .where((media) => media.id.in(validatedInput.mediaIds))
          .all();
        const foundIds = new Set(attachedMedia.map((m) => m.id));
        const allOwnedUnclaimedAndClaimable =
          attachedMedia.length === validatedInput.mediaIds.length &&
          validatedInput.mediaIds.every(
            (id) =>
              foundIds.has(id) &&
              attachedMedia.some(
                (m) =>
                  m.id === id &&
                  m.userId === sessionData.user.id &&
                  m.postId === null &&
                  m.commentId === null &&
                  m.messageConversationId === null &&
                  // Rejected, deleted, and failed media can never ride into
                  // a post; claimable statuses come from the pipeline
                  // contract so serving gates and this check cannot drift.
                  CLAIMABLE_STATUSES.includes(m.status)
              )
          );
        if (!allOwnedUnclaimedAndClaimable) {
          throw new Error("One or more attachments are invalid");
        }
      }

      if (validatedInput.mentions.length > 0) {
        // Self-mentions are dropped server-side: a crafted request could
        // otherwise farm MENTION_RECEIVED aura (and self-notifications) by
        // naming the author's own account, even though the UI never offers
        // that option.
        const validUsers = await tx.orm.public.Users.select("id")
          .where((user) => user.id.in(validatedInput.mentions))
          .all();

        const validUserIds = new Set(validUsers.map((u) => u.id));
        validatedInput.mentions = validatedInput.mentions.filter(
          (id) => id !== sessionData.user.id && validUserIds.has(id)
        );
      }

      // Resolve the response target inside the transaction so the parent
      // cannot be deleted between validation and the insert. rootPostId is the
      // thread's top-level POST (set for every response, so it marks a post as
      // a response even after its parent is gone); threadTopId is the thread's
      // top-level RESPONSE (null for a direct response) and is the pagination
      // anchor the responses API groups on.
      let parentPost: {
        aura: number;
        id: string;
        moderated: boolean;
        parentPostId: string | null;
        rootPostId: string | null;
        threadTopId: string | null;
        userId: string;
      } | null = null;
      let rootPostId: string | null = null;
      let threadTopId: string | null = null;
      let threadRootAuthorId: string | null = null;
      if (validatedInput.parentPostId) {
        parentPost = await tx.orm.public.Posts.select(
          "aura",
          "id",
          "moderated",
          "parentPostId",
          "rootPostId",
          "threadTopId",
          "userId"
        )
          .where({ id: validatedInput.parentPostId })
          .first();
        if (!parentPost) {
          throw new Error("The post you're responding to no longer exists");
        }
        if (parentPost.moderated) {
          throw new Error("That post is no longer available to respond to");
        }
        if (parentPost.parentPostId === null) {
          // Direct response to a top-level post: this node is the thread's
          // first level, so there is no higher response to group under.
          rootPostId = parentPost.id;
          threadTopId = null;
          threadRootAuthorId = parentPost.userId;
        } else {
          rootPostId = parentPost.rootPostId ?? parentPost.parentPostId;
          threadTopId = parentPost.threadTopId ?? parentPost.id;
          const threadRoot = rootPostId
            ? await tx.orm.public.Posts.select("userId")
                .where({ id: rootPostId })
                .first()
            : null;
          threadRootAuthorId = threadRoot?.userId ?? null;
        }
      }

      // Atomically claim the attachments for THIS post: the ownership
      // pre-check above is a read that two concurrent post creations could
      // both pass, and a plain connect would then let the second write
      // silently steal Media.postId. The post row is created FIRST so its id
      // exists inside this transaction - Media.postId carries a
      // non-deferrable FK, so claiming before the row exists would abort
      // every post with attachments. The conditional updateMany still only
      // matches unclaimed rows owned by the caller; a count mismatch means
      // another transaction won the race and this post creation aborts (the
      // claim rolls back with the transaction).
      const postId = crypto.randomUUID();
      const initialEmbedding = generateLocalEmbedding(
        `${validatedInput.content} ${validatedInput.tags.join(" ")}`
      );
      const post = await tx.orm.public.Posts.create({
        aura: 0,
        communityId,
        content: validatedInput.content,
        embedding: initialEmbedding,
        embeds: embedsJson,
        id: postId,
        isGust: validatedInput.isGust ?? false,
        parentPostId: parentPost?.id ?? null,
        rootPostId,
        semanticTags: [
          ...new Set(
            validatedInput.tags.map((tagName) => tagName.toLowerCase())
          ),
        ],
        threadTopId,
        userId: sessionData.user.id,
      });

      await runSequentially(validatedInput.mentions, async (userId) => {
        await tx.orm.public.Mentions.create({ postId: post.id, userId });
      });

      await runSequentially(validatedInput.tags, async (tagName) => {
        const normalizedTagName = tagName.toLowerCase();
        let tag = await tx.orm.public.Tag.select("id")
          .where({ name: normalizedTagName })
          .first();
        if (!tag) {
          tag = await tx.orm.public.Tag.create({ name: normalizedTagName });
        }
        await tx.orm.public.PostToTag.create({
          a: post.id,
          b: tag.id,
        });
      });

      if (validatedInput.mediaIds.length > 0) {
        const claim = await tx.orm.public.PostMedia.where((media) =>
          and(
            media.commentId.isNull(),
            media.id.in(validatedInput.mediaIds),
            media.messageConversationId.isNull(),
            media.postId.isNull(),
            media.status.in([...CLAIMABLE_STATUSES]),
            media.userId.eq(sessionData.user.id)
          )
        ).updateAndCount({ postId });
        if (claim !== validatedInput.mediaIds.length) {
          throw new Error("One or more attachments are invalid");
        }
      }

      // Publish confirmation from Zeph, the platform persona: lands in the
      // author's notifications the moment their fleet/gust goes live. Same
      // transaction as the post row so a confirmed post always has its
      // receipt.
      const zephUserId = await getModerationSystemUserId();
      const publishedNotification = await tx.orm.public.Notifications.select(
        "id"
      ).create({
        _type: "PUBLISHED",
        issuerId: zephUserId,
        postId: post.id,
        recipientId: sessionData.user.id,
      });
      publishedNotificationId = publishedNotification.id;

      // Notify the author of the post being responded to, plus the author of
      // the thread's root post (when different), deduped and never self. The
      // postId points at the RESPONSE so the notification deep-links to it.
      if (parentPost) {
        // Responses are high-signal engagement: award aura to the parent post and its author
        // when responded to by another user (self-responses never award aura).
        if (parentPost.userId !== sessionData.user.id) {
          await updatePostAuraWithCas(
            tx,
            parentPost.id,
            RESPONSE_RECEIVED_POST_AURA
          );

          await applyFlatAward(tx, {
            actorId: sessionData.user.id,
            baseAmount: RESPONSE_RECEIVED_AURA,
            now: new Date(),
            postId: parentPost.id,
            recipientId: parentPost.userId,
            subjectToDailyCap: true,
            type: "COMMENT_RECEIVED",
          });
        }

        if (
          threadRootAuthorId &&
          threadRootAuthorId !== sessionData.user.id &&
          threadRootAuthorId !== parentPost.userId
        ) {
          await applyFlatAward(tx, {
            actorId: sessionData.user.id,
            baseAmount: COMMENT_RECEIVED_AURA,
            now: new Date(),
            postId: rootPostId,
            recipientId: threadRootAuthorId,
            subjectToDailyCap: true,
            type: "COMMENT_RECEIVED",
          });
        }

        const replyRecipients = new Set<string>();
        if (parentPost.userId !== sessionData.user.id) {
          replyRecipients.add(parentPost.userId);
        }
        if (
          threadRootAuthorId &&
          threadRootAuthorId !== sessionData.user.id &&
          threadRootAuthorId !== parentPost.userId
        ) {
          replyRecipients.add(threadRootAuthorId);
        }
        const replyRecipientIds = [...replyRecipients];
        const replyNotifications = await Promise.all(
          replyRecipientIds.map((recipientId) =>
            tx.orm.public.Notifications.select("id", "recipientId").create({
              _type: "REPLY",
              issuerId: sessionData.user.id,
              postId: post.id,
              recipientId,
            })
          )
        );
        for (const notification of replyNotifications) {
          notificationEvents.created.push({
            notificationId: notification.id,
            recipientId: notification.recipientId,
          });
        }
      }

      // The media rows' postId just changed (draft uploads start unlinked), and
      // /api/media caches the row to drive its access decision. Drop that cache
      // so the now-public ownership is picked up immediately instead of serving
      // a stale "protected" row for up to an hour.
      if (validatedInput.mediaIds.length > 0) {
        updateTag("media-object");
      }

      if (input.hnStory) {
        await tx.orm.public.HnStoryShares.create({
          by: input.hnStory.by,
          descendants: input.hnStory.descendants,
          postId: post.id,
          score: input.hnStory.score,
          storyId: input.hnStory.storyId,
          time: input.hnStory.time,
          title: input.hnStory.title,
          url: input.hnStory.url || null,
        });
      }

      // Reshare of a community post onto the global feed: the new post owns
      // its own media, and this side row records the source for attribution.
      if (communityShare) {
        await tx.orm.public.CommunityPostShares.create({
          communityId: communityShare.communityId,
          postId: post.id,
          sourcePostId: communityShare.sourcePostId,
        });
      }

      // A native community post notifies the community's subscribers, batched
      // into one rolling row per reader. Runs in the same transaction so a
      // rolled-back publish leaves no notification behind.
      if (communityId) {
        communityNotifyNotifications = await notifyCommunitySubscribers(tx, {
          authorId: sessionData.user.id,
          communityId,
          postId: post.id,
        });
      }

      if (validatedInput.mentions.length > 0) {
        const mentionNotifications = await Promise.all(
          validatedInput.mentions.map(async (userId) => {
            const notification = await tx.orm.public.Notifications.select(
              "id",
              "recipientId"
            ).create({
              _type: "MENTION",
              issuerId: sessionData.user.id,
              postId: post.id,
              recipientId: userId,
            });

            // Being mentioned pays the mentioned user a flat award, unique
            // per (post, user) by the Mention table and subject to their
            // daily cap so mass-mention spam stays bounded.
            await applyFlatAward(tx, {
              actorId: sessionData.user.id,
              baseAmount: MENTION_RECEIVED_AURA,
              now: new Date(),
              postId: post.id,
              recipientId: userId,
              subjectToDailyCap: true,
              type: "MENTION_RECEIVED",
            });
            return notification;
          })
        );

        for (const notification of mentionNotifications) {
          notificationEvents.created.push({
            notificationId: notification.id,
            recipientId: notification.recipientId,
          });
        }
      }

      // Creation income is flat but daily-cap subject, so posting farms are
      // bounded. Sequential calls inside this transaction see each other's
      // income, so the cap applies cumulatively across base + bonuses.
      await applyFlatAward(tx, {
        actorId: sessionData.user.id,
        baseAmount: AURA_REWARDS.BASE_POST,
        now: new Date(),
        postId: post.id,
        recipientId: sessionData.user.id,
        subjectToDailyCap: true,
        type: "POST_CREATION",
      });

      if (input.hnStory) {
        await applyFlatAward(tx, {
          actorId: sessionData.user.id,
          baseAmount: AURA_REWARDS.HN_SHARE,
          now: new Date(),
          postId: post.id,
          recipientId: sessionData.user.id,
          subjectToDailyCap: true,
          type: "HN_SHARE_BONUS",
        });
      }

      const attachmentBonus =
        auraReward -
        AURA_REWARDS.BASE_POST -
        (input.hnStory ? AURA_REWARDS.HN_SHARE : 0);
      if (attachmentBonus > 0) {
        await applyFlatAward(tx, {
          actorId: sessionData.user.id,
          baseAmount: attachmentBonus,
          now: new Date(),
          postId: post.id,
          recipientId: sessionData.user.id,
          subjectToDailyCap: true,
          type: "POST_ATTACHMENT_BONUS",
        });
      }

      const completePostRow = await getPostDataQuery(
        tx.orm,
        sessionData.user.id
      )
        .where({ id: post.id })
        .first();
      if (!completePostRow) {
        throw new Error("Created post not found");
      }
      return mapPostData(completePostRow);
    });

    // A new community post changes the community's aggregate aura and the
    // global post-derived aggregates (hero totals, top-by-aura), so drop both
    // caches so the sidebar and discover hero reflect it on the next read. Best
    // effort: a cache miss only means a stale count for a minute.
    if (communityId) {
      try {
        await Promise.all([
          invalidateCommunityStats(communityId),
          invalidateCommunityPostAggregates(),
        ]);
      } catch (error) {
        console.error("Failed to invalidate community stats:", error);
      }
    }

    // Committed: reply and mention events can reach the worker now.
    flushNotificationEvents(notificationEvents, "post");

    // Bump the unread badge for each subscriber who got a new notification row.
    // Post-commit and best-effort, like the other fan-out events: a queue
    // hiccup costs a stale badge, never the publish.
    for (const notification of communityNotifyNotifications) {
      void enqueueNotificationSafely(notification.recipientId, notification.id);
    }

    // The media is now attached to a post, so the abandoned-upload cleanup jobs must not delete it.
    // Enqueue media analyze only AFTER the transaction commits so a rollback does not leave an orphan job.
    for (const mediaId of validatedInput.mediaIds) {
      // oxlint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
      void cancelMediaCleanup(mediaId).catch((error: unknown) => {
        console.error(`Failed to cancel media cleanup for ${mediaId}:`, error);
      });
      // oxlint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
      void enqueueMediaAnalyze(mediaId).catch((error: unknown) => {
        console.error(`Failed to enqueue media analyze for ${mediaId}:`, error);
      });
    }

    // Schedule cleanup of Zeph's publish confirmation notification after 15 minutes.
    if (publishedNotificationId) {
      void (async () => {
        try {
          await schedulePublishedNotificationCleanup(publishedNotificationId);
        } catch (error: unknown) {
          console.error(
            "Failed to schedule published notification cleanup:",
            error
          );
        }
      })();
    }

    // Signal refresh after commit; failures only cost cache freshness.
    // Mentioned users earned aura too, so their signals refresh in the same
    // call.
    const signalUserIds = new Set([sessionData.user.id]);
    for (const userId of validatedInput.mentions) {
      signalUserIds.add(userId);
    }
    if (newPost?.parentPost?.userId) {
      signalUserIds.add(newPost.parentPost.userId);
    }
    try {
      await invalidateAuraSignals([...signalUserIds]);
    } catch (error) {
      console.error("Failed to invalidate aura signals:", error);
    }

    // A new response fans out to everyone viewing the thread. The channel is
    // keyed on the thread ROOT (not the immediate parent) so nested responses
    // reach every viewer of the post, and the responder's own engagement
    // should shape their next For-You load.
    if (newPost?.parentPostId && newPost.rootPostId) {
      try {
        await publishResponseCreated(newPost.rootPostId, newPost);
      } catch (error) {
        console.error("Failed to publish response event:", error);
      }
      void invalidateFypProfile(sessionData.user.id);
    }

    // IndexNow: fire-and-forget so Bing/Yandex discover the URL same-day.
    // Never block the response on network; swallow errors.
    if (newPost) {
      const postUrl = getPostUrl(newPost);
      const authorUrl = `${siteConfig.url}/users/${sessionData.user.username ?? sessionData.user.id}`;
      void (async () => {
        try {
          const { submitManyToIndexNow } = await import("@/lib/seo/indexnow");
          // Submit the post + author profile + first hashtag page if any
          const urls = [postUrl, authorUrl];
          const firstTag = (newPost as { tags?: { name: string }[] }).tags?.[0]
            ?.name;
          if (firstTag) {
            urls.push(
              `${siteConfig.url}/hashtag/${encodeURIComponent(firstTag)}`
            );
          }
          await submitManyToIndexNow(urls);
        } catch (error) {
          console.warn("[indexnow] post submit failed", error);
        }
      })();
    }

    // The worker checks whether this post (or gust) pushed the author over the
    // shitposter threshold inside the rolling window and grants the badge. The
    // wrapper swallows enqueue failures so a Redis hiccup never fails the post.
    await enqueueShitposterCheckSafely(sessionData.user.id);

    return newPost;
  } catch (error) {
    console.error("Error in submitPost:", error);
    throw error;
  }
}

export async function incrementPostView(postId: string) {
  const [{ getClientIpFromHeaders, hashViewerId }, { headers }, sessionModule] =
    await Promise.all([
      import("@asm/db"),
      import("next/headers"),
      import("@/lib/auth/session"),
    ]);
  const sessionData = await sessionModule.getSessionFromApi();
  const userId = sessionData?.user?.id;
  const viewerHash = userId
    ? undefined
    : hashViewerId(getClientIpFromHeaders(await headers()));
  return await postViewsCache.incrementView(postId, { userId, viewerHash });
}

export async function getPostViews(postId: string) {
  return await postViewsCache.getViews(postId);
}

export async function updatePostTags(postId: string, tags: string[]) {
  const { getSessionFromApi } = await import("@/lib/auth/session");
  const sessionData = await getSessionFromApi();
  if (!sessionData?.user) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.orm.public.Posts.select("userId")
    .include("postToTags", (postTag) =>
      postTag.include("tag", (tag) => tag.select("name"))
    )
    .where({ id: postId })
    .first();

  if (!post) {
    throw new Error("Post not found");
  }
  if (post.userId !== sessionData.user.id) {
    throw new Error("Unauthorized");
  }

  const oldTags = post.postToTags.flatMap((postTag) =>
    postTag.tag ? [postTag.tag.name] : []
  );
  const tagsToAdd = tags.filter((t) => !oldTags.includes(t));
  const tagsToRemove = oldTags.filter((t) => !tags.includes(t));

  return await prisma.transaction(async (tx) => {
    if (tagsToRemove.length > 0) {
      await tx.orm.public.PostToTag.where((postTag) =>
        and(
          postTag.a.eq(postId),
          postTag.tag.some((tag) => tag.name.in(tagsToRemove))
        )
      ).delete();
    }
    await runSequentially(tagsToAdd, async (tagName) => {
      let tag = await tx.orm.public.Tag.select("id")
        .where({ name: tagName })
        .first();
      if (!tag) {
        tag = await tx.orm.public.Tag.create({ name: tagName });
      }
      await tx.orm.public.PostToTag.create({ a: postId, b: tag.id });
    });
    const updatedPostRow = await getPostDataQuery(tx.orm, sessionData.user.id)
      .where({ id: postId })
      .first();
    if (!updatedPostRow) {
      throw new Error("Post not found");
    }
    await Promise.all([
      ...tagsToAdd.map((tagName) => tagCache.incrementTagCount(tagName)),
      ...tagsToRemove.map((tagName) => tagCache.decrementTagCount(tagName)),
    ]);
    return mapPostData(updatedPostRow);
  });
}

export async function updatePostMentions(postId: string, mentions: string[]) {
  try {
    const { getSessionFromApi } = await import("@/lib/auth/session");
    const sessionData = await getSessionFromApi();
    if (!sessionData?.user) {
      throw new Error("Unauthorized");
    }

    const post = await prisma.orm.public.Posts.select("userId")
      .include("mentions", (mention) => mention.select("id"))
      .where({ id: postId })
      .first();

    if (!post) {
      throw new Error("Post not found");
    }
    if (post.userId !== sessionData.user.id) {
      throw new Error("Unauthorized");
    }

    const notificationEvents = newNotificationEvents();
    const updated = await prisma.transaction(async (tx) => {
      await tx.orm.public.Mentions.where({ postId }).delete();

      if (mentions.length > 0) {
        await runSequentially(mentions, async (userId) => {
          await tx.orm.public.Mentions.create({ postId, userId });
        });

        await runSequentially(mentions, async (userId) => {
          const notification = await tx.orm.public.Notifications.select(
            "id",
            "recipientId"
          ).create({
            _type: "MENTION",
            issuerId: sessionData.user.id,
            postId,
            recipientId: userId,
          });
          notificationEvents.created.push({
            notificationId: notification.id,
            recipientId: notification.recipientId,
          });
        });
      }

      const updatedRow = await getPostDataQuery(tx.orm, sessionData.user.id)
        .where({ id: postId })
        .first();
      if (!updatedRow) {
        throw new Error("Post not found");
      }
      return mapPostData(updatedRow);
    });
    flushNotificationEvents(notificationEvents, "mention");
    return updated;
  } catch (error) {
    console.error("Error updating mentions:", error);
    throw error;
  }
}
