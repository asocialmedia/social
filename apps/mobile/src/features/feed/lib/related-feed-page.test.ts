import { expect, test } from "bun:test";

import { parseRelatedFeedPage } from "./related-feed-page";

test("related pages preserve the server continuation cursor", () => {
  expect(
    parseRelatedFeedPage({ nextCursor: "continue-here", posts: [] })
  ).toEqual({
    cursor: "continue-here",
    items: [],
  });
  expect(
    parseRelatedFeedPage({ nextCursor: null, posts: [] }).cursor
  ).toBeNull();
});

test("malformed related responses become retryable errors instead of an empty feed", () => {
  for (const payload of [null, [], { posts: null }, { error: "unavailable" }]) {
    expect(() => parseRelatedFeedPage(payload)).toThrow(
      "Couldn't load related posts."
    );
  }
});
