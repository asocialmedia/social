// Pure tests for the persistent TTL cache helpers.
// Covers freshness, pruning, parsing and file naming without touching
// expo-file-system (which bun cannot parse).
import { describe, expect, test } from "bun:test";

import {
  emptySnapshot,
  isFreshEntry,
  parseSnapshot,
  pruneSnapshot,
  serializeSnapshot,
  snapshotFileName,
} from "./persistent-cache";

describe("isFreshEntry", () => {
  test("fresh within ttl", () => {
    expect(isFreshEntry({ data: 1, fetchedAt: 1000 }, 1500, 1000)).toBe(true);
  });
  test("stale past ttl", () => {
    expect(isFreshEntry({ data: 1, fetchedAt: 1000 }, 2500, 1000)).toBe(false);
  });
  test("null entry is stale", () => {
    expect(isFreshEntry(null, 1500, 1000)).toBe(false);
  });
  test("future write is stale", () => {
    expect(isFreshEntry({ data: 1, fetchedAt: 5000 }, 1500, 1000)).toBe(false);
  });
});

describe("pruneSnapshot", () => {
  test("drops expired and keeps newest up to cap", () => {
    const snap = {
      entries: {
        a: { data: "a", fetchedAt: 1000 },
        b: { data: "b", fetchedAt: 1500 },
        c: { data: "c", fetchedAt: 100 },
      },
      version: 1,
    };
    const pruned = pruneSnapshot(snap, 2000, 1000, 2);
    // c expired (1900 old), a+b fresh, cap 2 keeps both.
    expect(Object.keys(pruned.entries).sort()).toEqual(["a", "b"]);
  });
  test("cap evicts oldest", () => {
    const snap = {
      entries: {
        a: { data: "a", fetchedAt: 1000 },
        b: { data: "b", fetchedAt: 1100 },
        c: { data: "c", fetchedAt: 1200 },
      },
      version: 1,
    };
    const pruned = pruneSnapshot(snap, 1500, 5000, 2);
    expect(Object.keys(pruned.entries).sort()).toEqual(["b", "c"]);
  });
});

describe("parseSnapshot", () => {
  test("round trips", () => {
    const snap = { entries: { k: { data: { x: 1 }, fetchedAt: 42 } }, version: 1 };
    const parsed = parseSnapshot<typeof snap.entries.k.data>(serializeSnapshot(snap));
    expect(parsed.entries["k"]?.data).toEqual({ x: 1 });
  });
  test("corrupt body returns empty", () => {
    expect(parseSnapshot("{nope")).toEqual(emptySnapshot());
  });
  test("wrong version returns empty", () => {
    expect(parseSnapshot(JSON.stringify({ entries: {}, version: 99 }))).toEqual(emptySnapshot());
  });
});

describe("snapshotFileName", () => {
  test("sanitizes", () => {
    expect(snapshotFileName("Feed Cache/v2")).toBe("asm-feed-cache-v2.json");
  });
});
