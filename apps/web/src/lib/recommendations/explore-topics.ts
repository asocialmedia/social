import type { UserProfile } from "@asm/db";
import { matchesAvoidedTopic } from "@asm/protocols/discovery";
import type { NetworkTopicScope } from "@asm/protocols/discovery";

import { isRetrievalTopic } from "@/lib/protocols/recommendations";

// Explore tests observed neighbors and taxonomy siblings instead of repeating the strongest Home topics.
export function exploreTopics(
  profile: UserProfile,
  interests: readonly string[],
  avoided: readonly string[],
  scope?: NetworkTopicScope
): string[] {
  const direct = new Set(
    [
      ...interests,
      ...Object.entries(profile.tagWeights)
        .filter(([, weight]) => weight >= 0.15)
        .map(([topic]) => topic),
    ].map((topic) => topic.toLowerCase())
  );
  const related = [
    ...interests.flatMap((topic) => scope?.related?.[topic] ?? []),
    ...Object.entries(profile.expandedEntityWeights ?? {})
      .toSorted((a, b) => b[1] - a[1])
      .filter(([, weight]) => weight > 0)
      .map(([topic]) => topic),
  ];
  return [...new Set(related)]
    .filter(
      (topic) =>
        isRetrievalTopic(topic) &&
        !direct.has(topic.toLowerCase()) &&
        !matchesAvoidedTopic(topic, [topic], avoided)
    )
    .slice(0, 20);
}
