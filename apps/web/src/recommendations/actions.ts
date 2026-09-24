"use server";

import { and, invalidateFypProfile, prisma } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "recommendation-actions" });

// Dismissing a post from a ranked feed. This is a durable hide, not just a
// client-side removal: the event is written to the same RecommendationEvent
// table the profile reads, and `getPersonalizedFeedPage` excludes any post with
// a NOT_INTERESTED event from the candidate pool, so the dismissal survives a
// reload. Undo deletes the event and the post becomes eligible again.
//
// Post existence is verified so a crafted id cannot seed rows for a post that
// does not exist (the FK would reject it anyway, but a clean error is nicer).
async function requirePost(postId: string): Promise<void> {
  const post = await prisma.orm.public.Posts.select("id")
    .where({ id: postId })
    .first();
  if (!post) {
    throw new Error("Post not found");
  }
}

export async function hideRecommendationPost(postId: string): Promise<void> {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Sign in to do that");
  }

  await requirePost(postId);

  // One NOT_INTERESTED row per (user, post). A delete-then-create pair is NOT
  // safe here: two tabs can both delete before either creates, leaving two
  // rows, which then eat into the feed's exclusion cap. `dedupeKey` is the
  // table's existing unique column, so an upsert on it is atomic - the second
  // writer updates the (empty) row instead of inserting a duplicate.
  const dedupeKey = `not_interested:${userId}:${postId}`;
  const existing = await prisma.orm.public.RecommendationEvents.select("id")
    .where({ dedupeKey })
    .first();
  await (existing
    ? prisma.orm.public.RecommendationEvents.where({
        id: existing.id,
      }).update({})
    : prisma.orm.public.RecommendationEvents.create({
        dedupeKey,
        eventType: "NOT_INTERESTED",
        postId,
        userId,
      }));

  // The taste profile was built with this post's author/tags down-weighted;
  // dropping the cache lets the next feed build reflect the hide.
  await invalidateFypProfile(userId);
  logger.info({ postId, userId }, "recommendation post hidden");
}

export async function unhideRecommendationPost(postId: string): Promise<void> {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Sign in to do that");
  }

  await prisma.orm.public.RecommendationEvents.where((event) =>
    and(
      event.eventType.eq("NOT_INTERESTED"),
      event.postId.eq(postId),
      event.userId.eq(userId)
    )
  ).delete();

  await invalidateFypProfile(userId);
  logger.info({ postId, userId }, "recommendation post unhidden");
}
