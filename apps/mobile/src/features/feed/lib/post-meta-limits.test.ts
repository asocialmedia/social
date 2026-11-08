import { expect, test } from "bun:test";

import {
  filterSelfMentionIds,
  MAX_POST_MENTIONS,
  MAX_POST_TAGS,
  mentionLimitReached,
  tagLimitReached,
} from "./post-meta-limits";

test("tag cap matches web's 5-tag limit", () => {
  expect(MAX_POST_TAGS).toBe(5);
  expect(tagLimitReached(["a", "b", "c", "d"])).toBe(false);
  expect(tagLimitReached(["a", "b", "c", "d", "e"])).toBe(true);
});

test("mention cap matches web's 5-mention limit", () => {
  expect(MAX_POST_MENTIONS).toBe(5);
  expect(mentionLimitReached([{ id: "1" }])).toBe(false);
  expect(
    mentionLimitReached([
      { id: "1" },
      { id: "2" },
      { id: "3" },
      { id: "4" },
      { id: "5" },
    ])
  ).toBe(true);
});

test("mention updates filter out the current user like web", () => {
  expect(filterSelfMentionIds(["a", "b"], "a")).toEqual(["b"]);
  expect(filterSelfMentionIds(["a"], null)).toEqual(["a"]);
  expect(filterSelfMentionIds([], "a")).toEqual([]);
});
