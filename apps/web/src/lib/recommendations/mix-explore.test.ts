import { expect, test } from "bun:test";

import { mixExplorePosts, diversifyExploreCandidates } from "./mix-explore";

test("Explore preserves both source rankings and namespaces identities while deduplicating pages", () => {
  const result = mixExplorePosts(
    [{ id: "1" }, { id: "2" }, { id: "1" }],
    [{ id: "1" }, { id: "3" }]
  );
  expect(result.map((entry) => `${entry.source}:${entry.post.id}`)).toEqual([
    "asm:1",
    "bluesky:1",
    "asm:2",
    "bluesky:3",
  ]);
});

test("an unavailable network never drops the other network's Explore results", () => {
  expect(
    mixExplorePosts([{ id: "native" }], []).map((entry) => entry.post.id)
  ).toEqual(["native"]);
  expect(
    mixExplorePosts([], [{ id: "remote" }]).map((entry) => entry.post.id)
  ).toEqual(["remote"]);
});

test("Explore holds a broad discovery slot among related results without losing provider rank", () => {
  const result = diversifyExploreCandidates(
    ["a", "b", "c", "d", "e", "f", "cat", "nature"],
    (id) => id.length === 1
  );
  expect(result.slice(0, 5)).toEqual(["a", "b", "c", "d", "cat"]);
  expect(new Set(result).size).toBe(8);
  expect(diversifyExploreCandidates(["a", "b"], () => false)).toEqual([
    "a",
    "b",
  ]);
});
