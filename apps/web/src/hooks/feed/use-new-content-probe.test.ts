import { describe, expect, test } from "bun:test";

import {
  findUnseenItems,
  findUnseenRankedItems,
} from "./use-new-content-probe";

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

describe("findUnseenRankedItems", () => {
  test("keeps a new post that ranked below posts already on screen", () => {
    // A score-ordered feed can leave the head row untouched while an arriving
    // post lands eighth, which is exactly the case the leading-run walk drops.
    const fresh = [item("head"), item("mid"), item("arrived"), item("tail")];
    const unseen = findUnseenRankedItems(
      fresh,
      new Set(["head", "mid", "tail"])
    );
    expect(unseen.map((entry) => entry.id)).toEqual(["arrived"]);
  });

  test("returns nothing when the whole ranked page is already rendered", () => {
    const fresh = [item("a"), item("b")];
    expect(findUnseenRankedItems(fresh, new Set(["a", "b"]))).toEqual([]);
  });

  test("returns every row when the viewer has nothing yet", () => {
    const fresh = [item("a"), item("b")];
    expect(
      findUnseenRankedItems(fresh, new Set<string>()).map((entry) => entry.id)
    ).toEqual(["a", "b"]);
  });

  test("returns an empty list for an empty page", () => {
    expect(findUnseenRankedItems([], new Set(["a"]))).toEqual([]);
  });
});
