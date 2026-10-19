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
  const selected = new Set(interests.map(normalizeTopic));
  return (
    [
      ...new Set(
        interests
          .flatMap((root) => [root, ...(scope?.interests[root] ?? [])])
          .map(normalizeTopic)
      ),
    ]
      // Short inferred letter aliases collide with prose; explicit selections and numbered names remain usable.
      .filter(
        (term) =>
          term.length >= 2 &&
          term.length <= 64 &&
          (term.length >= 4 || /\p{N}/u.test(term) || selected.has(term))
      )
      .slice(0, 160)
  );
}

type InterestMatcher = (text: string, topics: readonly string[]) => number;
const scopedMatchers = new WeakMap<
  NetworkTopicScope,
  Map<string, InterestMatcher>
>();
const exactMatchers = new Map<string, InterestMatcher>();

function interestMatcher(
  interests: readonly string[],
  scope?: NetworkTopicScope
): InterestMatcher {
  let cache = exactMatchers;
  if (scope) {
    cache = scopedMatchers.get(scope) ?? new Map<string, InterestMatcher>();
    scopedMatchers.set(scope, cache);
  }
  const key = JSON.stringify(interests);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const roots = [...new Set(interests)].map((root) => ({
    qualifiers: scope?.qualifiers?.[root] ?? [],
    terms: networkInterestTerms([root], scope).map((term) => ({
      compact: term.replaceAll(/\s+/gu, ""),
      pattern: new RegExp(
        `(?:^|[^\\p{L}\\p{N}_])${term.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}_])`,
        "u"
      ),
    })),
  }));
  const contextual = roots.some((root) => root.qualifiers.length > 1);
  const match: InterestMatcher = (text, topics) => {
    const normalizedText = normalizeTopic(text);
    const declared = new Set(
      topics.map((topic) => normalizeTopic(topic).replaceAll(/\s+/gu, ""))
    );
    const words = contextual
      ? (`${normalizedText} ${topics.join(" ")}`
          .toLowerCase()
          .match(/[\p{L}\p{N}\p{M}]+/gu) ?? [])
      : [];
    let score = 0;
    for (const root of roots) {
      const matched =
        root.qualifiers.length > 1
          ? root.qualifiers.every((token) =>
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
                  common >= 6 &&
                  common / Math.max(word.length, token.length) >= 0.8
                );
              })
            )
          : root.terms.some(
              (term) =>
                declared.has(term.compact) || term.pattern.test(normalizedText)
            );
      score += Number(matched);
    }
    return score;
  };
  if (cache.size >= 128) {
    cache.delete(cache.keys().next().value ?? "");
  }
  cache.set(key, match);
  return match;
}

// Compile a profile's topic expressions once, then reuse them across every candidate and feed mode.
export function networkInterestScore(
  text: string,
  topics: readonly string[],
  interests: readonly string[],
  scope?: NetworkTopicScope
): number {
  return interestMatcher(interests, scope)(text, topics);
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
