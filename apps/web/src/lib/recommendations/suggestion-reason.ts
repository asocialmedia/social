import type { UserProfile } from "@asm/db";
import { networkInterestScore } from "@asm/protocols/discovery";
import type { NetworkTopicScope } from "@asm/protocols/discovery";

// An explanation names evidence that actually matched this account or its public posts.
export function suggestionReason(
  profile: UserProfile,
  interests: readonly string[],
  text: string,
  topics: string[],
  author: string,
  scope?: NetworkTopicScope
): string | null {
  const explicit = interests.find(
    (interest) => networkInterestScore(text, topics, [interest], scope) > 0
  );
  if (explicit) {
    return `Shares your interest in ${explicit}`;
  }
  const learned = Object.entries(profile.tagWeights)
    .filter(
      ([topic, weight]) =>
        weight >= 0.05 && weight > (profile.negativeTagWeights?.[topic] ?? 0)
    )
    .toSorted((a, b) => b[1] - a[1])
    .find(([topic]) => networkInterestScore(text, topics, [topic]) > 0);
  if (learned) {
    return `You’ve been exploring ${learned[0]}`;
  }
  if ((profile.authorWeights[author] ?? 0) > 0.1) {
    return "You’ve interacted with their posts";
  }
  return null;
}
