import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalRegionalRelevance,
  createExternalTopicMatcher,
  mergeTopicWeights,
} from "@asm/protocols/contracts";

export function discoveryTopics(profile: UserProfile): string[] {
  const weights = mergeTopicWeights(
    profile.tagWeights,
    profile.topicAffinities,
    profile.sessionTagWeights
  );
  const negative = mergeTopicWeights(profile.negativeTagWeights);
  const summaryTopics = Object.keys(
    mergeTopicWeights(
      Object.fromEntries(
        (profile.summary?.topTags ?? []).map((tag) => [tag, 1])
      )
    )
  );
  const ranked = Object.entries(weights)
    .filter(([tag, weight]) => weight > 0 && (negative[tag] ?? 0) < weight)
    .toSorted((first, second) => second[1] - first[1])
    .map(([tag]) => tag);
  return [
    ...new Set(
      [
        ...ranked,
        ...summaryTopics.filter(
          (tag) => (negative[tag] ?? 0) < (weights[tag] ?? 1)
        ),
      ]
        .map((tag) =>
          tag
            .replaceAll(/[^\p{L}\p{N} _-]/gu, " ")
            .replaceAll(/\s+/g, " ")
            .trim()
        )
        .filter((tag) => tag.length >= 2 && tag.length <= 80)
    ),
  ].slice(0, 5);
}

export function rankExternalForViewer(
  posts: ExternalPost[],
  profile: UserProfile,
  options: { locale?: string; now?: number } = {}
): ExternalPost[] {
  const now = options.now ?? Date.now();
  const positive = mergeTopicWeights(
    profile.tagWeights,
    profile.topicAffinities,
    profile.sessionTagWeights,
    profile.expandedEntityWeights
  );
  const negative = mergeTopicWeights(profile.negativeTagWeights);
  const score = (post: ExternalPost) => {
    const matchTopic = createExternalTopicMatcher(post);
    let value = 0;
    for (const [tag, weight] of Object.entries(positive)) {
      value += matchTopic(tag) * Math.log1p(Math.max(0, weight));
    }
    for (const [tag, weight] of Object.entries(negative)) {
      value -= matchTopic(tag) * Math.log1p(Math.max(0, weight)) * 2;
    }
    value += Math.log1p(
      Math.max(0, profile.authorWeights[post.author.id] ?? 0)
    );
    value -=
      Math.log1p(
        Math.max(0, profile.negativeAuthorWeights?.[post.author.id] ?? 0)
      ) * 2;
    const formats = post.media.length
      ? [...new Set(post.media.map((media) => media.type))]
      : ["text" as const];
    value +=
      Math.max(
        ...formats.map((format) => profile.formatAffinities?.[format] ?? 0)
      ) * 0.3;
    value += externalRegionalRelevance(post, options.locale ?? "all") * 0.2;
    // Context breaks weak-interest ties without letting popularity overwhelm deliberate preferences.
    const hours = Math.max(0, (now - Date.parse(post.createdAt)) / 3_600_000);
    value += 0.15 / (1 + hours / 24);
    const counts = post.upstreamCounts;
    const engagement =
      counts.likes + counts.reposts * 2 + counts.replies + counts.quotes * 2;
    value += Math.min(0.1, Math.log1p(engagement) * 0.01) / (1 + hours / 24);
    value -= post.replyTo ? 0.1 : 0;
    return value;
  };
  return posts
    .map((post) => ({ post, score: score(post) }))
    .toSorted((first, second) => second.score - first.score)
    .map(({ post }) => post);
}
