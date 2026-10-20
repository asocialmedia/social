import type { UserProfile } from "@asm/db";
import { mergeTopicWeights } from "@asm/protocols/contracts";

export function suggestionAffinity(
  profile: UserProfile,
  text: string,
  topics: string[],
  author: string
): number {
  const haystack = text.normalize("NFKC").toLowerCase();
  const declared = new Set(topics.map((topic) => topic.toLowerCase()));
  const match = (topic: string) => {
    if (declared.has(topic)) {
      return 2;
    }
    const escaped = topic.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
      "u"
    ).test(haystack)
      ? 1
      : 0;
  };
  const positive = mergeTopicWeights(
    profile.tagWeights,
    profile.topicAffinities,
    profile.sessionTagWeights,
    profile.expandedEntityWeights
  );
  const negative = mergeTopicWeights(profile.negativeTagWeights);
  let score =
    Math.log1p(
      Math.max(
        0,
        profile.authorWeights[author] ??
          profile.authorWeights[author.replace(/^asm:/, "")] ??
          0
      )
    ) * 3;
  for (const [topic, weight] of Object.entries(positive)) {
    score += match(topic) * Math.log1p(Math.max(0, weight));
  }
  for (const [topic, weight] of Object.entries(negative)) {
    score -= match(topic) * Math.log1p(Math.max(0, weight)) * 3;
  }
  score -=
    Math.log1p(Math.max(0, profile.negativeAuthorWeights?.[author] ?? 0)) * 5;
  return score;
}
