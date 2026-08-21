"use server";

import type { CreatePostInput } from "@asm/auth/validation";
import { createGustSchema, createPostSchema } from "@asm/auth/validation";
import {
  cancelMediaCleanup,
  enqueueNotificationCreated,
  enqueueShitposterCheck,
  getPostDataInclude,
  postViewsCache,
  prisma,
  tagCache,
} from "@asm/db";

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

const AURA_REWARDS = {
  ATTACHMENTS: {
    AUDIO: {
      BASE: 25,
      MAX_BONUS: 16,
      PER_ITEM: 8,
    },
    CODE: {
      BASE: 15,
      MAX_BONUS: 45,
      PER_ITEM: 15,
    },
    IMAGE: {
      BASE: 20,
      MAX_BONUS: 25,
      PER_ITEM: 5,
    },
    VIDEO: {
      BASE: 40,
      MAX_BONUS: 20,
      PER_ITEM: 10,
    },
  },
  BASE_POST: 10,
  HN_SHARE: 15,
  MAX_TOTAL: 150,
};

type AttachmentType = "IMAGE" | "VIDEO" | "AUDIO" | "CODE";

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
    CODE: 0,
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
      const baseReward = config.BASE;
      const bonusReward = Math.min(count * config.PER_ITEM, config.MAX_BONUS);
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
      if (validatedInput.mentions.length > 0) {
        const validUsers = await tx.user.findMany({
          select: { id: true },
          where: {
            id: {
              in: validatedInput.mentions,
            },
          },
        });

        const validUserIds = new Set(validUsers.map((u) => u.id));
        validatedInput.mentions = validatedInput.mentions.filter((id) =>
          validUserIds.has(id)
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
          validatedInput.mentions.map((userId) =>
            tx.notification.create({
              data: {
                issuerId: sessionData.user.id,
                postId: post.id,
                recipientId: userId,
                type: "MENTION",
              },
            })
          )
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

      await tx.user.update({
        data: { aura: { increment: auraReward } },
        where: { id: sessionData.user.id },
      });

      await tx.auraLog.create({
        data: {
          amount: AURA_REWARDS.BASE_POST,
          issuerId: sessionData.user.id,
          postId: post.id,
          type: "POST_CREATION",
          userId: sessionData.user.id,
        },
      });

      if (input.hnStory) {
        await tx.auraLog.create({
          data: {
            amount: AURA_REWARDS.HN_SHARE,
            issuerId: sessionData.user.id,
            postId: post.id,
            type: "POST_ATTACHMENT_BONUS",
            userId: sessionData.user.id,
          },
        });
      }

      const attachmentBonus =
        auraReward -
        AURA_REWARDS.BASE_POST -
        (input.hnStory ? AURA_REWARDS.HN_SHARE : 0);
      if (attachmentBonus > 0) {
        await tx.auraLog.create({
          data: {
            amount: attachmentBonus,
            issuerId: sessionData.user.id,
            postId: post.id,
            type: "POST_ATTACHMENT_BONUS",
            userId: sessionData.user.id,
          },
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
  const { getSessionFromApi } = await import("@/lib/session");
  const sessionData = await getSessionFromApi();
  return await postViewsCache.incrementView(postId, sessionData?.user?.id);
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
