import { expect, test } from "bun:test";

import { placeExploreItems } from "./explore-masonry";

test("late source arrivals and continuation pages append below existing cards without column rebalancing", () => {
  const original = placeExploreItems(
    [],
    ["asm:1", "asm:2", "asm:3", "asm:4"],
    2
  );
  const appended = placeExploreItems(
    original,
    ["asm:1", "bsky:1", "asm:2", "bsky:2", "asm:3", "asm:4", "asm:5"],
    2
  );
  for (const [index, column] of original.entries()) {
    expect(appended[index].slice(0, column.length)).toEqual(column);
  }
  expect(new Set(appended.flat()).size).toBe(7);
  expect(
    placeExploreItems(
      appended,
      ["asm:1", "bsky:1", "asm:3", "asm:4", "asm:5"],
      2
    ).flat()
  ).not.toContain("asm:2");
});

test("a responsive column change redistributes once and keeps every unique card", () => {
  const ids = ["a", "b", "c", "d", "e", "e"];
  const columns = placeExploreItems(placeExploreItems([], ids, 2), ids, 3);
  expect(columns).toHaveLength(3);
  expect(columns.flat().toSorted()).toEqual(["a", "b", "c", "d", "e"]);
});
