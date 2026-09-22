import { describe, expect, test } from "bun:test";

import {
  isPostVisible,
  setVisiblePostIds,
  subscribePostVisibility,
} from "./visible-posts";

describe("visible posts", () => {
  test("publishes membership and notifies only on change", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribePostVisibility("p1", (visible) => {
      seen.push(visible);
    });
    setVisiblePostIds(new Set(["p1", "p2"]));
    expect(isPostVisible("p1")).toBe(true);
    expect(isPostVisible("p3")).toBe(false);
    // Same membership resubmitted: no notification.
    setVisiblePostIds(new Set(["p2", "p1"]));
    setVisiblePostIds(new Set(["p2"]));
    unsubscribe();
    setVisiblePostIds(new Set());
    expect(seen).toEqual([true, false]);
    expect(isPostVisible("p1")).toBe(false);
  });
});
