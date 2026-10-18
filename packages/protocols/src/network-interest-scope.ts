import { normalizeInterest } from "./network-preferences";
import type { NetworkTopicScope } from "./network-topics";

function normalizeTopic(value: string): string {
  return normalizeInterest(value)
    .replaceAll(/[._-]+/gu, " ")
    .replaceAll(/\s+/gu, " ");
}

// Expansions are resolved from topic data. This module contains no subject vocabulary.
export function networkInterestTerms(
  interests: readonly string[],
  scope?: NetworkTopicScope
): string[] {
  return [
    ...new Set(
      interests
        .flatMap((root) => [root, ...(scope?.interests[root] ?? [])])
        .map(normalizeTopic)
    ),
  ]
    .filter((term) => term.length >= 2 && term.length <= 64)
    .slice(0, 160);
}

export function networkInterestScore(
  text: string,
  topics: readonly string[],
  interests: readonly string[],
  scope?: NetworkTopicScope
): number {
  const normalizedText = normalizeTopic(text);
  const declared = new Set(
    topics.map((topic) => normalizeTopic(topic).replaceAll(/\s+/gu, ""))
  );
  let score = 0;
  const words =
    `${normalizedText} ${topics.join(" ")}`
      .toLowerCase()
      .match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  for (const root of new Set(interests)) {
    const qualifiers = scope?.qualifiers?.[root] ?? [];
    if (qualifiers.length > 1) {
      const contextual = qualifiers.every((token) =>
        words.some((word) => {
          if (word === token || word.replace(/s$/u, "") === token) {
            return true;
          }
          let common = 0;
          while (
            common < word.length &&
            common < token.length &&
            word[common] === token[common]
          ) {
            common += 1;
          }
          return (
            common >= 6 && common / Math.max(word.length, token.length) >= 0.8
          );
        })
      );
      score += Number(contextual);
      continue;
    }
    const matched = networkInterestTerms([root], scope).some((term) => {
      if (declared.has(term.replaceAll(/\s+/gu, ""))) {
        return true;
      }
      const escaped = term.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
        "u"
      ).test(normalizedText);
    });
    score += Number(matched);
  }
  return score;
}

export function matchesNetworkInterests(
  text: string,
  topics: readonly string[],
  interests: readonly string[],
  scope?: NetworkTopicScope
): boolean {
  return (
    interests.length === 0 ||
    networkInterestScore(text, topics, interests, scope) > 0
  );
}
