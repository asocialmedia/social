import { prisma } from "@asm/db";

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
  const eventWriter = prisma.recommendationEvent;
  if (!eventWriter) {
    return;
  }
  try {
    await eventWriter.create({
      data: {
        eventType: input.eventType,
        postId: input.postId,
        userId: input.userId,
      },
    });
  } catch {
    // Recommendation signals are best effort and must never block a social action.
  }
}
