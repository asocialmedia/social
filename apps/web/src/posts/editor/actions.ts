"use server";

import type { CreatePostInput } from "@asm/auth/validation";
import { createGustSchema, createPostSchema } from "@asm/auth/validation";
import {
  applyFlatAward,
  ATTACHMENT_BONUSES,
  cancelMediaCleanup,
  enqueueNotificationCreated,
  enqueueShitposterCheck,
  getPostDataInclude,
  HN_SHARE_BONUS_AURA,
  invalidateAuraSignals,
  MENTION_RECEIVED_AURA,
  POST_CREATION_AURA,
  POST_CREATION_MAX_AURA,
  postViewsCache,
  prisma,
  tagCache,
} from "@asm/db";
import { updateTag } from "next/cache";

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

async function calculateAuraReward(mediaIds: string[], hasHnStory: boolean) {
  let totalAura = hasHnStory
    ? AURA_REWARDS.BASE_POST + AURA_REWARDS.HN_SHARE
    : AURA_REWARDS.BASE_POST;

  if (!mediaIds.length) {
    return totalAura;
  }

  const mediaItems = await prisma.media.findMany({
    select: { id: true, type: true },
    where: { id: { in: mediaIds } },
  });

  const typeCount: Record<AttachmentType, number> = {
    AUDIO: 0,
    IMAGE: 0,
    VIDEO: 0,
  };

  for (const item of mediaItems) {
    const type = item.type as AttachmentType;
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
    const { getSessionFromApi } = await import("@/lib/session");
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

    const parsed = (input.isGust ? createGustSchema : createPostSchema).parse({
      content: input.content,
      isGust: input.isGust ?? false,
      mediaIds: input.mediaIds || [],
      mentions: input.mentions || [],
      tags: input.tags || [],
    });
    const validatedInput: CreatePostInput = parsed;

    const auraReward = await calculateAuraReward(
      validatedInput.mediaIds,
      !!input.hnStory
    );

    const newPost = await prisma.$transaction(async (tx) => {
      // Attachments must be owned by the caller and unclaimed: a crafted
      // mediaId could otherwise drag another user's comment attachment (or an
      // owner-only draft) into a public post, and the post-deletion worker
      // would then permanently delete the victim's storage objects. Mirrors
      // the ownership validation the comment flow already applies.
      if (validatedInput.mediaIds.length > 0) {
        const attachedMedia = await tx.media.findMany({
          select: {
            commentId: true,
            id: true,
            postId: true,
            userId: true,
          },
          where: { id: { in: validatedInput.mediaIds } },
        });
        const foundIds = new Set(attachedMedia.map((m) => m.id));
        const allOwnedAndUnclaimed =
          attachedMedia.length === validatedInput.mediaIds.length &&
          validatedInput.mediaIds.every(
            (id) =>
              foundIds.has(id) &&
              attachedMedia.some(
                (m) =>
                  m.id === id &&
                  m.userId === sessionData.user.id &&
                  m.postId === null &&
                  m.commentId === null
              )
          );
        if (!allOwnedAndUnclaimed) {
          throw new Error("One or more attachments are invalid");
        }
      }

      if (validatedInput.mentions.length > 0) {
        // Self-mentions are dropped server-side: a crafted request could
        // otherwise farm MENTION_RECEIVED aura (and self-notifications) by
        // naming the author's own account, even though the UI never offers
        // that option.
        const validUsers = await tx.user.findMany({
          select: { id: true },
          where: {
            id: {
              in: validatedInput.mentions,
            },
          },
        });

        const validUserIds = new Set(validUsers.map((u) => u.id));
        validatedInput.mentions = validatedInput.mentions.filter(
          (id) => id !== sessionData.user.id && validUserIds.has(id)
        );
      }

      const post = await tx.post.create({
        data: {
          attachments: {
            connect: validatedInput.mediaIds.map((id) => ({ id })),
          },
          aura: 0,
          content: validatedInput.content,
          isGust: validatedInput.isGust ?? false,
          mentions:
            validatedInput.mentions.length > 0
              ? {
                  create: validatedInput.mentions.map((userId) => ({
                    userId,
                  })),
                }
              : undefined,
          tags: {
            connectOrCreate: validatedInput.tags.map((tagName) => ({
              create: { name: tagName.toLowerCase() },
              where: { name: tagName.toLowerCase() },
            })),
          },
          userId: sessionData.user.id,
        },
        include: {
          ...getPostDataInclude(sessionData.user.id),
          hnStoryShare: true,
          mentions: {
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
          },
          tags: true,
        },
      });

      // The media is now attached to a post, so the abandoned-upload cleanup
      // jobs must not delete it.
      for (const mediaId of validatedInput.mediaIds) {
        cancelMediaCleanup(mediaId).catch((error: unknown) => {
          console.error(
            `Failed to cancel media cleanup for ${mediaId}:`,
            error
          );
        });
      }

      // The media rows' postId just changed (draft uploads start unlinked), and
      // /api/media caches the row to drive its access decision. Drop that cache
      // so the now-public ownership is picked up immediately instead of serving
      // a stale "protected" row for up to an hour.
      if (validatedInput.mediaIds.length > 0) {
        updateTag("media-object");
      }

      if (input.hnStory) {
        await tx.hNStoryShare.create({
          data: {
            by: input.hnStory.by,
            descendants: input.hnStory.descendants,
            postId: post.id,
            score: input.hnStory.score,
            storyId: input.hnStory.storyId,
            time: input.hnStory.time,
            title: input.hnStory.title,
            url: input.hnStory.url || null,
          },
        });
      }

      if (validatedInput.mentions.length > 0) {
        await Promise.all(
          validatedInput.mentions.map(async (userId) => {
            await tx.notification.create({
              data: {
                issuerId: sessionData.user.id,
                postId: post.id,
                recipientId: userId,
                type: "MENTION",
              },
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
          })
        );

        for (const userId of validatedInput.mentions) {
          enqueueNotificationCreated(userId).catch((error: unknown) => {
            console.error(
              "Failed to enqueue mention notification event:",
              error
            );
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
          type: "POST_ATTACHMENT_BONUS",
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

      const completePost = await tx.post.findUnique({
        include: {
          ...getPostDataInclude(sessionData.user.id),
          hnStoryShare: true,
          mentions: {
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
          },
          tags: true,
        },
        where: { id: post.id },
      });

      return completePost;
    });

    // Signal refresh after commit; failures only cost cache freshness.
    try {
      await invalidateAuraSignals([sessionData.user.id]);
    } catch (error) {
      console.error("Failed to invalidate aura signals:", error);
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
      import("@/lib/session"),
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
  const { getSessionFromApi } = await import("@/lib/session");
  const sessionData = await getSessionFromApi();
  if (!sessionData?.user) {
    throw new Error("Unauthorized");
  }

  const post = await prisma.post.findUnique({
    include: { tags: true },
    where: { id: postId },
  });

  if (!post) {
    throw new Error("Post not found");
  }
  if (post.userId !== sessionData.user.id) {
    throw new Error("Unauthorized");
  }

  const oldTags = post.tags.map((t) => t.name);
  const tagsToAdd = tags.filter((t) => !oldTags.includes(t));
  const tagsToRemove = oldTags.filter((t) => !tags.includes(t));

  return await prisma.$transaction(async (tx) => {
    const updatedPost = await tx.post.update({
      data: {
        tags: {
          connectOrCreate: tagsToAdd.map((tagName) => ({
            create: { name: tagName },
            where: { name: tagName },
          })),
          disconnect: tagsToRemove.map((tagName) => ({ name: tagName })),
        },
      },
      include: getPostDataInclude(sessionData.user.id),
      where: { id: postId },
    });

    await Promise.all([
      ...tagsToAdd.map((tagName) => tagCache.incrementTagCount(tagName)),
      ...tagsToRemove.map((tagName) => tagCache.decrementTagCount(tagName)),
    ]);

    return updatedPost;
  });
}

export async function updatePostMentions(postId: string, mentions: string[]) {
  try {
    const { getSessionFromApi } = await import("@/lib/session");
    const sessionData = await getSessionFromApi();
    if (!sessionData?.user) {
      throw new Error("Unauthorized");
    }

    const post = await prisma.post.findUnique({
      include: { mentions: true },
      where: { id: postId },
    });

    if (!post) {
      throw new Error("Post not found");
    }
    if (post.userId !== sessionData.user.id) {
      throw new Error("Unauthorized");
    }

    return await prisma.$transaction(async (tx) => {
      await tx.mention.deleteMany({
        where: { postId },
      });

      if (mentions.length > 0) {
        await tx.mention.createMany({
          data: mentions.map((userId) => ({
            postId,
            userId,
          })),
        });

        await tx.notification.createMany({
          data: mentions.map((userId) => ({
            issuerId: sessionData.user.id,
            postId,
            recipientId: userId,
            type: "MENTION",
          })),
        });

        for (const userId of mentions) {
          enqueueNotificationCreated(userId).catch((error: unknown) => {
            console.error(
              "Failed to enqueue mention notification event:",
              error
            );
          });
        }
      }

      return await tx.post.findUnique({
        include: {
          ...getPostDataInclude(sessionData.user.id),
          hnStoryShare: true,
        },
        where: { id: postId },
      });
    });
  } catch (error) {
    console.error("Error updating mentions:", error);
    throw error;
  }
}
