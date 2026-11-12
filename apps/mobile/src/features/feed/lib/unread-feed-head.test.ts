import { expect, test } from "bun:test";

import { mergeUnreadFeedHead } from "./unread-feed-head";

test("automatic admission retains unread posts after the source buffer clears", () => {
  const first = { author: "alice", id: "one" };
  const admitted = mergeUnreadFeedHead([], [first]);
  expect(mergeUnreadFeedHead(admitted, [])).toEqual([first]);
  expect(
    mergeUnreadFeedHead(admitted, [first, { author: "bob", id: "two" }])
  ).toEqual([first, { author: "bob", id: "two" }]);
});

test("a repeated probe updates a post without increasing its unread count", () => {
  expect(
    mergeUnreadFeedHead(
      [{ id: "one", revision: 1 }],
      [{ id: "one", revision: 2 }]
    )
  ).toEqual([{ id: "one", revision: 2 }]);
});
