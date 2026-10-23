import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalRegionalRelevance,
  createExternalTopicMatcher,
  mergeTopicWeights,
} from "@asm/protocols/contracts";
import {
  discoveryTopicsSchema,
  networkInterestTerms,
  isExternalTrendingPost,
} from "@asm/protocols/discovery";
import type { NetworkTopicScope } from "@asm/protocols/discovery";

import { externalNetworkInterestScore } from "@/lib/posts/network-content-policy";
import { uniqueFeedContent } from "@/lib/posts/unique-feed-content";

export function normalizeDiscoveryTopics(topics: readonly string[]): string[] {
  return [
    ...new Set(
      topics
        .map((topic) =>
          topic
            .normalize("NFKC")
            .toLowerCase()
            .replaceAll(/[^\p{L}\p{M}\p{N} _-]/gu, " ")
            .replaceAll(/\s+/gu, " ")
            .trim()
        )
        .filter((topic) => discoveryTopicsSchema.safeParse([topic]).success)
    ),
  ];
}

export function isRetrievalTopic(topic: string): boolean {
  return (
    topic.length <= 64 &&
    !/(?:^|\b)(?:category|portal|wikipedia|lists?|outlines?|stubs?|glossar(?:y|ies)|templates?)(?:\b|:)|\bby (?:country|period|type|medium|source|studio|composer|director|writer|year|date|genre|setting)\b/iu.test(
      topic
    )
  );
}

export function discoveryTopics(
  profile: UserProfile,
  interests: readonly string[] = [],
  scope?: NetworkTopicScope
): string[] {
  if (interests.length) {
    const chosen = networkInterestTerms(interests);
    const aliases = interests.flatMap((root) => scope?.aliases?.[root] ?? []);
    return normalizeDiscoveryTopics([
      ...chosen.filter((term) => term.split(" ").length <= 3),
      ...aliases.toSorted((a, b) => a.length - b.length),
      ...chosen,
    ])
      .filter(
        (topic) =>
          topic.length >= 4 || /\p{N}/u.test(topic) || chosen.includes(topic)
      )
      .filter(isRetrievalTopic)
      .slice(0, 5);
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
    .filter(([tag, weight]) => weight >= 0.15 && (negative[tag] ?? 0) < weight)
    .toSorted((first, second) => second[1] - first[1])
    .map(([tag]) => tag);
  const direct = normalizeDiscoveryTopics([
    ...ranked,
    ...summaryTopics.filter(
      (tag) =>
        (weights[tag] ?? 0) >= 0.15 &&
        (negative[tag] ?? 0) < (weights[tag] ?? 0)
    ),
  ]).filter(isRetrievalTopic);
  const related = normalizeDiscoveryTopics(
    Object.entries(profile.expandedEntityWeights ?? {})
      .filter(
        ([topic, weight]) =>
          weight >= 0.15 && !direct.includes(topic) && !(negative[topic] > 0)
      )
      .toSorted((a, b) => b[1] - a[1])
      .map(([topic]) => topic)
  )
    .filter(isRetrievalTopic)
    .find((topic) => !direct.includes(topic));
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
    allowExploration?: boolean;
    video?: boolean;
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
  const positiveTerms = Object.entries(positive);
  const negativeTerms = Object.entries(negative);
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
    for (const [tag, weight] of positiveTerms) {
      value += matchTopic(tag) * Math.log1p(Math.max(0, weight));
    }
    for (const [tag, weight] of negativeTerms) {
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
    value +=
      Math.min(2, Math.log1p(engagement) * 0.35) / (1 + hours / 24) ** 0.8;
    if (options.video) {
      value +=
        Math.min(4, Math.log1p(engagement) * 0.5) / (1 + hours / 24) ** 0.8;
    }
    value -= post.replyTo ? 0.1 : 0;
    value +=
      Math.min(1, Math.max(0, options.socialProof?.get(post.id) ?? 0)) * 2;
    return options.mode === "trending"
      ? (Math.log1p(engagement) / (1 + hours / 24) ** 0.6) * 8 +
          Math.min(3, fit) +
          Math.max(-1, Math.min(1, value * 0.05))
      : Math.min(1, fit) * 4 +
          Math.max(0, Math.min(3, fit) - 1) * 0.5 +
          2 / (1 + hours / 24) +
          value;
  };
  const candidates = uniqueFeedContent(
    posts
      .filter(
        (post) => options.mode !== "trending" || isExternalTrendingPost(post)
      )
      .filter(
        (post) =>
          options.allowExploration ||
          !interests.length ||
          externalNetworkInterestScore(post, interests, options.topicScope) > 0
      )
      .map((post) => ({ post, score: score(post) }))
      .toSorted((first, second) => second.score - first.score),
    (item) => item.post.text,
    (item) => item.post.quote?.id ?? item.post.replyTo ?? ""
  );
  const result: ExternalPost[] = [];
  const authors = new Map<string, number>();
  const topics = new Map<string, number>();
  while (candidates.length) {
    let selected = 0;
    let best = -Infinity;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const tags =
        options.topics?.get(candidate.post.id) ?? candidate.post.tags ?? [];
      const repetition =
        (authors.get(candidate.post.author.id) ?? 0) * 8 +
        Math.min(3, Math.max(0, ...tags.map((tag) => topics.get(tag) ?? 0))) *
          0.8;
      const value = candidate.score - repetition;
      if (value > best) {
        best = value;
        selected = index;
      }
    }
    const [candidate] = candidates.splice(selected, 1);
    result.push(candidate.post);
    authors.set(
      candidate.post.author.id,
      (authors.get(candidate.post.author.id) ?? 0) + 1
    );
    for (const tag of options.topics?.get(candidate.post.id) ??
      candidate.post.tags ??
      []) {
      topics.set(tag, (topics.get(tag) ?? 0) + 1);
    }
  }
  return result;
}
