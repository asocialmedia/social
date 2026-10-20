import { expect, test } from "bun:test";

import type { UserProfile } from "@asm/db";

import { suggestionAffinity } from "./suggestion-ranking";
import { mixSuggestionSources } from "./suggestion-types";

test("the same persona ranks textual, tagged and author evidence across protocols and penalizes negative topics", () => {
  const profile: UserProfile = {
    authorWeights: { "bluesky:did:plc:tech": 4 },
    negativeTagWeights: { politics: 8 },
    tagWeights: { software: 5 },
  };
  const text = suggestionAffinity(
    profile,
    "Software tutorials",
    [],
    "asm:person"
  );
  expect(text).toBeGreaterThan(0);
  expect(
    suggestionAffinity(profile, "Latest updates", ["software"], "asm:person")
  ).toBeGreaterThan(text);
  expect(
    suggestionAffinity(profile, "Software politics", [], "asm:person")
  ).toBeLessThan(0);
  expect(
    suggestionAffinity(profile, "Latest updates", [], "bluesky:did:plc:tech")
  ).toBeGreaterThan(0);
  expect(
    suggestionAffinity(profile, "Softwarex unrelated", [], "asm:person")
  ).toBe(0);
});

test("source mixing preserves relevance within each network, deduplicates identities and never invents a missing source", () => {
  const items = [
    { id: "one", score: 20, source: "asm" as const },
    { id: "two", score: 10, source: "asm" as const },
    { id: "one", score: 30, source: "bluesky" as const },
    { id: "two", score: 5, source: "bluesky" as const },
    { id: "one", score: 3, source: "asm" as const },
  ];
  expect(
    mixSuggestionSources(items, 4).map((item) => `${item.source}:${item.id}`)
  ).toEqual(["bluesky:one", "asm:one", "bluesky:two", "asm:two"]);
  expect(
    mixSuggestionSources(
      items.filter((item) => item.source === "asm"),
      6
    )
  ).toHaveLength(2);
  expect(mixSuggestionSources([], 4)).toEqual([]);
});
