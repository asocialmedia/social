import { describe, expect, test } from "bun:test";

import { orderedCopy, reversedCopy } from "./ordered-copy";

describe("Hermes-compatible immutable ordering", () => {
  test("orders epochs newest first and preserves equal-epoch order", () => {
    const epochs = Object.freeze([
      { id: "older", version: 1 },
      { id: "first", version: 3 },
      { id: "second", version: 3 },
      { id: "middle", version: 2 },
    ]);
    expect(
      orderedCopy(epochs, (a, b) => b.version - a.version).map((e) => e.id)
    ).toEqual(["first", "second", "middle", "older"]);
    expect(epochs[0].id).toBe("older");
  });
  test("reverses a frozen transcript without mutating the store", () => {
    const rows = Object.freeze(["oldest", "middle", "newest"]);
    expect(reversedCopy(rows)).toEqual(["newest", "middle", "oldest"]);
    expect(rows[0]).toBe("oldest");
    expect(reversedCopy([])).toEqual([]);
  });
});
