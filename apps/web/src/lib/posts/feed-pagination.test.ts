import { expect, test } from "bun:test";

import { canAutoContinueFeed, feedContinuationDelay } from "./feed-pagination";

const items = (page: { id: string }[]) => page;

test("an idle sparse feed backs off repeated empty continuations and resets when content arrives", () => {
  expect(feedContinuationDelay([[], [], []], items)).toBe(2000);
  expect(feedContinuationDelay([[], [], [], []], items)).toBe(4000);
  expect(
    feedContinuationDelay(
      Array.from({ length: 12 }, () => []),
      items
    )
  ).toBe(30_000);
  expect(feedContinuationDelay([[], [], [], [{ id: "fresh" }]], items)).toBe(0);
});

test("sparse feeds resume automatically with a delay instead of requiring a button", () => {
  expect(feedContinuationDelay([[{ id: "first" }], [], [], []], items)).toBe(
    2000
  );
  expect(
    feedContinuationDelay(
      [[{ id: "first" }], [], [], [], [{ id: "second" }]],
      items
    )
  ).toBe(0);
});

test("sparse and repeated continuations stop automatic loading without dropping the cursor", () => {
  expect(canAutoContinueFeed([[{ id: "first" }], [], []], items)).toBe(true);
  expect(canAutoContinueFeed([[{ id: "first" }], [], [], []], items)).toBe(
    false
  );
  expect(
    canAutoContinueFeed([[{ id: "first" }], [{ id: "first" }], [], []], items)
  ).toBe(false);
  expect(
    canAutoContinueFeed(
      [[{ id: "first" }], [], [], [], [{ id: "next" }]],
      items
    )
  ).toBe(true);
});

test("three pages hidden by exposure or recommendation filters stop both Explore sources", () => {
  const nativePages = ["home-seen", "wrong-interest", "blocked"].map((id) => ({
    posts: [{ id }],
  }));
  const externalPages = [
    "at://home-seen",
    "at://wrong-interest",
    "at://blocked",
  ].map((id) => ({ items: [{ id }] }));
  const visibleIds = new Set<string>();
  expect(
    canAutoContinueFeed(nativePages, (page) => page.posts, visibleIds)
  ).toBe(false);
  expect(
    canAutoContinueFeed(externalPages, (page) => page.items, visibleIds)
  ).toBe(false);
  const nextVisible = new Set(["eligible"]);
  expect(
    canAutoContinueFeed(
      [...nativePages, { posts: [{ id: "eligible" }] }],
      (page) => page.posts,
      nextVisible
    )
  ).toBe(true);
  expect(
    canAutoContinueFeed(
      [...externalPages, { items: [{ id: "eligible" }] }],
      (page) => page.items,
      nextVisible
    )
  ).toBe(true);
});
