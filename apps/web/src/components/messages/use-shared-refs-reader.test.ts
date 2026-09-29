// The seam between what a tab already holds and what a read just returned.
//
// A backfill walk or a live message both commit refs ABOVE everything the tab
// shows, so the refresh read starts at the newest key. The moment a user has
// scrolled past the first page, that read's top page OVERLAPS the rows already
// held — and every commit triggers another one. Getting this merge wrong is
// therefore not a one-off glitch but a shape the tab takes on every live
// message, which is why each case below is pinned rather than reasoned about.
//
// The two wrong answers this guards against:
//   - append: a second copy of everything the user is looking at, growing by a
//     page on every message.
//   - prepend blindly: the same duplication, plus the older rows pushed down, so
//     the grid never settles.

import { describe, expect, test } from "bun:test";

import { mergeRefs } from "./use-shared-refs-reader";

interface Row {
  flatKey: string;
  label: string;
}

function rows(...keys: string[]): Row[] {
  return keys.map((key) => ({ flatKey: key, label: key }));
}

function keysOf(items: readonly Row[]): string[] {
  return items.map((item) => item.flatKey);
}

describe("mergeRefs, load-older", () => {
  // A "load older" read starts strictly below the cursor, so there is nothing to
  // reconcile and the fast paths below are all a page can hit.
  test("appends a page below the rows already held", () => {
    expect(
      keysOf(mergeRefs(rows("d", "c", "b", "a"), rows("z"), "more"))
    ).toEqual(["d", "c", "b", "a", "z"]);
  });

  test("hands back the page itself when nothing is held", () => {
    const page = rows("c", "b", "a");
    // The same array, not a copy: the first page of a kind IS its whole history so
    // far, and copying it buys a page of garbage for nothing.
    expect(mergeRefs([], page, "more")).toBe(page);
  });
});

describe("mergeRefs, refresh", () => {
  test("prepends a new row ahead of everything held", () => {
    const merged = mergeRefs(rows("c", "b", "a"), rows("d"), "refresh");
    expect(keysOf(merged)).toEqual(["d", "c", "b", "a"]);
  });

  test("keeps the rows a user had already paged in", () => {
    // The bug this pins: restarting the list on every commit throws away five
    // screens of history the user scrolled to, and a busy conversation then keeps
    // resetting the grid under their finger.
    const held = rows("c", "b", "a", "9", "8", "7", "6", "5");
    const merged = mergeRefs(held, rows("c", "b", "a", "d"), "refresh");
    expect(keysOf(merged)).toStrictEqual([
      "d",
      "c",
      "b",
      "a",
      "9",
      "8",
      "7",
      "6",
      "5",
    ]);
  });

  // The overlap is the whole reason this function exists: the top page read on a
  // refresh covers rows the user is already looking at, so a merge that trusted
  // the page would put a second copy of the entire screen above the real one.
  test("drops the overlap between the top page and the rows held", () => {
    const merged = mergeRefs(
      rows("9", "8", "7", "6", "5", "4"),
      rows("c", "b", "a", "9", "8", "7"),
      "refresh"
    );
    expect(keysOf(merged)).toStrictEqual([
      "c",
      "b",
      "a",
      "9",
      "8",
      "7",
      "6",
      "5",
      "4",
    ]);
  });

  test("a page that is entirely overlap changes nothing, and keeps the same array", () => {
    const held = rows("9", "8", "7");
    // Nothing new landed. Returning a new array here would re-render every
    // virtualized row and reset its scroll anchor for no reason.
    expect(mergeRefs(held, rows("9", "8", "7"), "refresh")).toBe(held);
  });

  test("a fresh row interleaves correctly with an overlap", () => {
    // The live case: one new message lands while the user sits mid-grid. Its ref is
    // newer than the held rows but lands INSIDE the top page, not at its edge.
    const merged = mergeRefs(
      rows("b", "a", "9", "8"),
      rows("d", "c", "b", "a", "9"),
      "refresh"
    );
    expect(keysOf(merged)).toStrictEqual(["d", "c", "b", "a", "9", "8"]);
  });

  test("an empty page leaves the rows held", () => {
    const held = rows("b", "a");
    expect(mergeRefs(held, [], "refresh")).toBe(held);
  });

  test("nothing held yet means the page IS the list", () => {
    const page = rows("b", "a");
    expect(mergeRefs([], page, "refresh")).toBe(page);
  });

  // One message, many refs: a 10-image album contributes ten rows that share a
  // message id and differ only in position. Deduplicating on anything but the
  // position would collapse an album to a single tile.
  test("every ref of one message is a distinct row", () => {
    const album = rows(
      "m1:0",
      "m1:1",
      "m1:2",
      "m1:3",
      "m1:4",
      "m1:5",
      "m1:6",
      "m1:7",
      "m1:8",
      "m1:9"
    );
    const merged = mergeRefs(album, album, "refresh");
    expect(merged).toHaveLength(10);
    expect(merged).toBe(album);
  });

  test("an album straddling the overlap keeps every position exactly once", () => {
    const held = rows("m1:4", "m1:5", "m1:6", "m1:7", "m1:8", "m1:9");
    const top = rows("m2:0", "m1:0", "m1:1", "m1:2", "m1:3", "m1:4");
    const merged = mergeRefs(held, top, "refresh");
    expect(keysOf(merged)).toStrictEqual([
      "m2:0",
      "m1:0",
      "m1:1",
      "m1:2",
      "m1:3",
      "m1:4",
      "m1:5",
      "m1:6",
      "m1:7",
      "m1:8",
      "m1:9",
    ]);
  });
});
