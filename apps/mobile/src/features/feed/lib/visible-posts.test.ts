import { describe, expect, test } from "bun:test";

import {
  isAutoplayPost,
  isPostVisible,
  setAutoplayPostId,
  setVisiblePostIds,
  subscribeAutoplayPost,
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

// Autoplay needs its own "owner" signal: "viewable" is not "one video". A
// viewable thread group can hold several posts, and two short cards can each
// cover half the viewport, so playing every visible id ran multiple players at
// once - heard as doubled, slightly detuned audio.
describe("autoplay ownership", () => {
  test("only the nominated post owns the slot", () => {
    setVisiblePostIds(new Set(["a", "b"]));
    setAutoplayPostId("b");
    expect(isAutoplayPost("b")).toBe(true);
    // Both stay visible, so view tracking is unaffected - only one plays.
    expect(isPostVisible("a")).toBe(true);
    expect(isAutoplayPost("a")).toBe(false);
  });

  test("clearing the slot leaves nobody playing", () => {
    setAutoplayPostId("a");
    setAutoplayPostId(null);
    expect(isAutoplayPost("a")).toBe(false);
  });

  test("notifies only on gaining or losing the slot", () => {
    const events: boolean[] = [];
    const unsubscribe = subscribeAutoplayPost("a", (isOwner) => {
      events.push(isOwner);
    });
    setAutoplayPostId("a");
    // Re-nominating the same id is a no-op, so idle scrolls do not re-render.
    setAutoplayPostId("a");
    setAutoplayPostId("b");
    unsubscribe();
    setAutoplayPostId("a");
    expect(events).toEqual([true, false]);
  });
});
