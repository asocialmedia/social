import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";

export function discoveryTopics(profile: UserProfile): string[] {
  const weights = {
    ...profile.tagWeights,
    ...profile.topicAffinities,
    ...profile.sessionTagWeights,
  };
  const ranked = Object.entries(weights)
    .filter(
      ([tag, weight]) =>
        weight > 0 && (profile.negativeTagWeights?.[tag] ?? 0) < weight
    )
    .toSorted((first, second) => second[1] - first[1])
    .map(([tag]) => tag);
  return [
    ...new Set(
      [
        ...ranked,
        ...(profile.summary?.topTags ?? []).filter(
          (tag) =>
            (profile.negativeTagWeights?.[tag] ?? 0) < (weights[tag] ?? 1)
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
  profile: UserProfile
): ExternalPost[] {
  const score = (post: ExternalPost) => {
    const text =
      `${post.text} ${post.author.description ?? ""} ${post.externalLink?.title ?? ""}`.toLocaleLowerCase();
    let value = 0;
    for (const [tag, weight] of Object.entries({
      ...profile.tagWeights,
      ...profile.topicAffinities,
      ...profile.sessionTagWeights,
    })) {
      if (text.includes(tag.toLocaleLowerCase())) {
        value += Math.log1p(Math.max(0, weight));
      }
    }
    for (const [tag, weight] of Object.entries(
      profile.negativeTagWeights ?? {}
    )) {
      if (text.includes(tag.toLocaleLowerCase())) {
        value -= Math.log1p(Math.max(0, weight)) * 2;
      }
    }
    return value;
  };
  return posts.toSorted((first, second) => score(second) - score(first));
}
