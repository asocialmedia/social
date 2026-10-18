import {
  prisma,
  resolveLastRankingContext,
  getNetworkPersona,
  networkContentTopics,
  recordNetworkSignal,
  removeNetworkSignal,
} from "@asm/db";

export type RecommendationInteractionType =
  | "BOOKMARK"
  | "COMMENT"
  | "SHARE"
  | "VOTE";

export async function recordRecommendationInteraction(input: {
  eventType: RecommendationInteractionType;
  postId: string;
  userId: string;
}): Promise<void> {
  try {
    const context = await resolveLastRankingContext(input.userId, input.postId);
    await prisma.orm.public.RecommendationEvents.create({
      ...(context
        ? { rankingContext: { ...context, attribution: "last_impression" } }
        : {}),
      eventType: input.eventType,
      postId: input.postId,
      userId: input.userId,
    });
    const network = await getNetworkPersona(input.userId);
    const post = await prisma.orm.public.Posts.select(
      "content",
      "semanticTags",
      "userId",
      "communityId",
      "explicitContent"
    )
      .where({ id: input.postId })
      .first();
    if (post) {
      await recordNetworkSignal(
        input.userId,
        network.selected.id,
        {
          authorId: `asm:${post.userId}`,
          createdAt: Date.now(),
          kind: (
            {
              BOOKMARK: "bookmark",
              COMMENT: "comment",
              SHARE: "amplify",
              VOTE: "amplify",
            } as const
          )[input.eventType],
          tags: networkContentTopics(post.content, post.semanticTags ?? []),
        },
        `asm:${input.postId}`,
        post.communityId === null && !post.explicitContent
      );
    }
  } catch {
    // Recommendation signals are best effort and must never block a social action.
  }
}

export async function recordNegativeRecommendationInteraction(
  userId: string,
  postId: string,
  kind: "downvote" | "notInterested",
  remove = false
): Promise<void> {
  try {
    const network = await getNetworkPersona(userId);
    if (remove) {
      await removeNetworkSignal(
        userId,
        network.selected.id,
        kind,
        `asm:${postId}`
      );
      return;
    }
    const post = await prisma.orm.public.Posts.select(
      "content",
      "semanticTags",
      "userId"
    )
      .where({ id: postId })
      .first();
    if (post) {
      await recordNetworkSignal(
        userId,
        network.selected.id,
        {
          authorId: `asm:${post.userId}`,
          createdAt: Date.now(),
          kind,
          tags: networkContentTopics(post.content, post.semanticTags ?? []),
        },
        `asm:${postId}`
      );
    }
  } catch {
    // Learning failures must not fail the committed social action.
  }
}
