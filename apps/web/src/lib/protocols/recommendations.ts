import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalRegionalRelevance,
  createExternalTopicMatcher,
  mergeTopicWeights,
} from "@asm/protocols/contracts";
import { networkInterestTerms } from "@asm/protocols/discovery";
import type { NetworkTopicScope } from "@asm/protocols/discovery";

import { externalNetworkInterestScore } from "@/lib/posts/network-content-policy";

export function discoveryTopics(
  profile: UserProfile,
  interests: readonly string[] = [],
  scope?: NetworkTopicScope
): string[] {
  if (interests.length) {
    const chosen = networkInterestTerms(interests);
    const related = [
      ...new Set(interests.flatMap((root) => scope?.related?.[root] ?? [])),
    ];
    return [...chosen, ...related].slice(0, 5);
  }
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
  const direct = [
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
  ];
  const related = Object.entries(profile.expandedEntityWeights ?? {})
    .filter(
      ([topic, weight]) =>
        weight > 0 && !direct.includes(topic) && !(negative[topic] > 0)
    )
    .toSorted((a, b) => b[1] - a[1])
    .map(([topic]) => topic.replaceAll(/[^\p{L}\p{N} _-]/gu, " ").trim())
    .find((topic) => topic.length >= 2 && topic.length <= 80);
  return related ? [...direct.slice(0, 4), related] : direct.slice(0, 5);
}

export function rankExternalForViewer(
  posts: ExternalPost[],
  profile: UserProfile,
  options: {
    locale?: string;
    now?: number;
    mode?: "personalized" | "trending";
    topics?: ReadonlyMap<string, string[]>;
    interests?: readonly string[];
    topicScope?: NetworkTopicScope;
    socialProof?: ReadonlyMap<string, number>;
    followedAuthors?: ReadonlySet<string>;
  } = {}
): ExternalPost[] {
  const now = options.now ?? Date.now();
  const interests = options.interests ?? [];
  const positive = mergeTopicWeights(
    profile.tagWeights,
    profile.topicAffinities,
    profile.sessionTagWeights,
    profile.expandedEntityWeights
  );
  const negative = mergeTopicWeights(profile.negativeTagWeights);
  const score = (post: ExternalPost) => {
    const fit = externalNetworkInterestScore(
      post,
      interests,
      options.topicScope
    );
    const matchTopic = createExternalTopicMatcher({
      ...post,
      tags: [...(post.tags ?? []), ...(options.topics?.get(post.id) ?? [])],
    });
    let value = options.followedAuthors?.has(post.author.id) ? 3 : 0;
    for (const [tag, weight] of Object.entries(positive)) {
      value += matchTopic(tag) * Math.log1p(Math.max(0, weight));
    }
    for (const [tag, weight] of Object.entries(negative)) {
      value -= matchTopic(tag) * Math.log1p(Math.max(0, weight)) * 2;
    }
    value += Math.log1p(
      Math.max(
        0,
        profile.authorWeights[`${post.source}:${post.author.id}`] ??
          profile.authorWeights[post.author.id] ??
          0
      )
    );
    value -=
      Math.log1p(
        Math.max(
          0,
          profile.negativeAuthorWeights?.[`${post.source}:${post.author.id}`] ??
            profile.negativeAuthorWeights?.[post.author.id] ??
            0
        )
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
      (counts.likes ?? 0) +
      (counts.reposts ?? 0) * 2 +
      (counts.replies ?? 0) +
      (counts.quotes ?? 0) * 2;
    value += Math.min(0.1, Math.log1p(engagement) * 0.01) / (1 + hours / 24);
    value -= post.replyTo ? 0.1 : 0;
    value +=
      Math.min(1, Math.max(0, options.socialProof?.get(post.id) ?? 0)) * 2;
    return options.mode === "trending"
      ? fit * 20 +
          value * 0.5 +
          Math.min(5, Math.log1p(engagement) / (1 + hours / 24))
      : fit * 20 + value;
  };
  return posts
    .filter(
      (post) =>
        !interests.length ||
        externalNetworkInterestScore(post, interests, options.topicScope) > 0
    )
    .map((post) => ({ post, score: score(post) }))
    .toSorted((first, second) => second.score - first.score)
    .map(({ post }) => post);
}
