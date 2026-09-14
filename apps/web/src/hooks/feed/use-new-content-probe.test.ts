import { describe, expect, test } from "bun:test";

import { findUnseenItems } from "./use-new-content-probe";

const item = (id: string) => ({ id });

describe("findUnseenItems", () => {
  test("returns the leading run of items the viewer has not seen", () => {
    const fresh = [item("n2"), item("n1"), item("old"), item("older")];
    const unseen = findUnseenItems(fresh, new Set(["old", "older"]));
    expect(unseen.map((entry) => entry.id)).toEqual(["n2", "n1"]);
  });

  test("stops at the first known id so reordered bodies are not flagged", () => {
    const fresh = [item("known-head"), item("n1"), item("n2")];
    expect(findUnseenItems(fresh, new Set(["known-head"]))).toEqual([]);
  });

  test("treats everything as new when nothing is known yet", () => {
    const fresh = [item("a"), item("b")];
    const unseen = findUnseenItems(fresh, new Set<string>());
    expect(unseen.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("returns an empty list for an empty page", () => {
    expect(findUnseenItems([], new Set(["a"]))).toEqual([]);
  });
});
