import type { ExternalPost } from "@asm/protocols/contracts";
import { externalPostTopics } from "@asm/protocols/contracts";
import {
  isExternalTrendingPost,
  networkInterestScore,
} from "@asm/protocols/discovery";

import type { TrendingBlueskyTopic } from "@/components/home/sidebars/right/trending-actions";
import { externalNetworkPostAllowed } from "@/lib/posts/network-content-policy";

import type { NetworkFeedContext } from "./network-context";

// Count observed popular posts; a selected interest alone is never evidence of a trend.
export function interestTrendingTopics(
  posts: ExternalPost[],
  context: Pick<NetworkFeedContext, "preferences" | "topicScope"> & {
    selected: { interests: readonly string[] };
  },
  now = Date.now()
): TrendingBlueskyTopic[] {
  const topics = new Map<
    string,
    {
      posts: Set<string>;
      authors: Set<string>;
      interests: Set<string>;
      root: boolean;
    }
  >();
  const visited = new Set<string>();
  for (const post of posts) {
    const age = now - Date.parse(post.createdAt);
    if (
      visited.has(post.id) ||
      !Number.isFinite(age) ||
      age < -60_000 ||
      age > 7 * 86_400_000 ||
      !isExternalTrendingPost(post) ||
      !externalNetworkPostAllowed(post, context.preferences, context.topicScope)
    ) {
      continue;
    }
    visited.add(post.id);
    const tags = externalPostTopics(post);
    const matched = context.selected.interests.filter(
      (interest) =>
        networkInterestScore(post.text, tags, [interest], context.topicScope) >
        0
    );
    if (!matched.length) {
      continue;
    }
    for (const topic of new Set([...matched, ...tags])) {
      const normalized = topic.toLowerCase();
      const entry = topics.get(normalized) ?? {
        authors: new Set<string>(),
        interests: new Set<string>(),
        posts: new Set<string>(),
        root: matched.some((interest) => interest.toLowerCase() === normalized),
      };
      entry.posts.add(post.id);
      entry.authors.add(post.author.id);
      for (const interest of matched) {
        entry.interests.add(interest);
      }
      topics.set(normalized, entry);
    }
  }
  return [...topics]
    .filter(([, entry]) => entry.root || entry.authors.size >= 2)
    .toSorted(([, a], [, b]) => b.posts.size - a.posts.size)
    .slice(0, 20)
    .map(([topic, entry]) => ({
      description: `${entry.posts.size} popular ${entry.posts.size === 1 ? "post" : "posts"} in recent recommendations`,
      displayName: topic,
      link: `https://bsky.app/search?q=${encodeURIComponent(topic)}`,
      matchedInterests: [...entry.interests],
      source: "bluesky",
      topic,
      type: "bluesky_topic",
    }));
}
