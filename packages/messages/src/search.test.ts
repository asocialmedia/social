import { describe, expect, test } from "bun:test";

import {
  messageSearchGramKeys,
  messageSearchQueryGramKeys,
  messageSearchTerms,
  messageSearchTermsMatch,
  normalizeMessageSearchQuery,
  normalizeMessageSearchText,
  readMessageSearchFeatureFlags,
  searchableTextFromPayload,
  splitMessageSearchTerm,
} from "./search";

describe("message search shared contract", () => {
  test("keeps independent server search switches enabled by default", () => {
    expect(readMessageSearchFeatureFlags({})).toEqual({
      backfill: true,
      counts: true,
      serverSearch: true,
    });
  });

  test("disables only the explicitly selected search features", () => {
    expect(
      readMessageSearchFeatureFlags({
        MESSAGE_SEARCH_BACKFILL_ENABLED: " OFF ",
        MESSAGE_SEARCH_COUNT_ENABLED: "false",
        MESSAGE_SEARCH_SERVER_ENABLED: "1",
      })
    ).toEqual({
      backfill: false,
      counts: false,
      serverSearch: true,
    });
  });

  test("treats malformed values as enabled to avoid accidental outages", () => {
    expect(
      readMessageSearchFeatureFlags({
        MESSAGE_SEARCH_BACKFILL_ENABLED: "not-a-boolean",
        MESSAGE_SEARCH_COUNT_ENABLED: "0",
        MESSAGE_SEARCH_SERVER_ENABLED: "yes",
      })
    ).toEqual({
      backfill: true,
      counts: false,
      serverSearch: true,
    });
  });

  test("normalizes case and combining diacritics consistently", () => {
    expect(normalizeMessageSearchText("RÉSUMÉ CAFÉ")).toBe("resume cafe");
  });

  test("matches fragments in words, URLs, emoji, and non-space scripts", () => {
    const terms = messageSearchTerms(
      "redeployment https://example.com/🚀東京語 café"
    );
    expect(messageSearchTermsMatch(terms, "deploy")).toBe(true);
    expect(messageSearchTermsMatch(terms, "example.com")).toBe(true);
    expect(messageSearchTermsMatch(terms, "🚀東")).toBe(true);
    expect(messageSearchTermsMatch(terms, "cafe")).toBe(true);
  });

  test("requires every whitespace-separated query fragment", () => {
    const terms = messageSearchTerms("redeployment rollback");
    expect(messageSearchTermsMatch(terms, "deploy back")).toBe(true);
    expect(messageSearchTermsMatch(terms, "deploy absent")).toBe(false);
  });

  test("requires two Unicode code points and bounds normalized query points", () => {
    expect(normalizeMessageSearchQuery("a").valid).toBe(false);
    expect(normalizeMessageSearchQuery("a b").valid).toBe(true);
    expect(normalizeMessageSearchQuery("🙂").valid).toBe(false);
    expect(normalizeMessageSearchQuery("😀a").valid).toBe(true);
    expect(normalizeMessageSearchQuery("x".repeat(257)).valid).toBe(false);
  });

  test("uses Unicode character grams that preserve punctuation", () => {
    const grams = messageSearchGramKeys("a😀");
    expect(grams).toContain("1:😀");
    expect(grams).toContain("2:a😀");
    expect(messageSearchQueryGramKeys("//")).toEqual(["2://"]);
  });

  test("overlaps long terms enough to cover every accepted query fragment", () => {
    const term = `${"a".repeat(257)}needle${"b".repeat(300)}`;
    const chunks = splitMessageSearchTerm(term);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => [...chunk].length <= 512)).toBe(true);
    expect(messageSearchTermsMatch(chunks, "needle")).toBe(true);
  });

  test("uses the same non-text labels as the loaded-message path", () => {
    expect(searchableTextFromPayload({ postId: "p1", type: "post" })).toBe(
      "Shared a post"
    );
    expect(
      searchableTextFromPayload({
        images: [1, 2],
        kind: "image",
        type: "media",
      })
    ).toBe("Shared 2 images");
  });
});
