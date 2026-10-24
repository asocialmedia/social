import { expect, test } from "bun:test";

import { reconcileFeedOrder } from "./feed-order";

test("a continuation stays below existing native rows even when its dates rank above them", () => {
  const external = { id: "bluesky:first" };
  const native = { id: "asm:old" };
  const next = { id: "bluesky:next" };
  expect(
    reconcileFeedOrder(
      [external, native],
      [next, external, native],
      [[native.id], [external.id, next.id]]
    )
  ).toEqual([external, native, next]);
});

test("revealing a buffered head prepends it while retaining the existing reading order", () => {
  const external = { id: "bluesky:first" };
  const native = { id: "asm:first" };
  const head = { id: "bluesky:head" };
  expect(
    reconcileFeedOrder(
      [native, external],
      [head, external, native],
      [[native.id], [head.id, external.id]]
    )
  ).toEqual([head, native, external]);
});

test("a slow source's first page follows posts the viewer can already read", () => {
  const native = { id: "asm:first" };
  const external = { id: "bluesky:first" };
  expect(
    reconcileFeedOrder(
      [native],
      [external, native],
      [[native.id], [external.id]]
    )
  ).toEqual([native, external]);
});

test("updates and removals retain current data without resurrecting filtered posts", () => {
  const first = { id: "first", likes: 1 };
  const removed = { id: "removed", likes: 0 };
  const updated = { ...first, likes: 2 };
  expect(reconcileFeedOrder([first, removed], [updated], [[first.id]])).toEqual(
    [updated]
  );
});

test("a replaced feed adopts its new ranking", () => {
  const next = [{ id: "new-second" }, { id: "new-first" }];
  expect(reconcileFeedOrder([{ id: "old" }], next, [])).toEqual(next);
});
