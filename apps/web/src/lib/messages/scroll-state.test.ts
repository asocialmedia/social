import { describe, expect, test } from "bun:test";

import {
  formatArrivalCount,
  isNearBottom,
  MAX_BADGE_COUNT,
  nextArrivalCount,
} from "./scroll-state";

function viewport(scrollTop: number, scrollHeight = 1000, clientHeight = 400) {
  return { clientHeight, scrollHeight, scrollTop };
}

describe("isNearBottom", () => {
  test("is pinned exactly at the bottom", () => {
    // scrollHeight - scrollTop - clientHeight = 0
    expect(isNearBottom(viewport(600))).toBe(true);
  });

  test("is pinned within the threshold", () => {
    expect(isNearBottom(viewport(500))).toBe(true); // 100px away
  });

  test("is unpinned beyond the threshold", () => {
    expect(isNearBottom(viewport(499))).toBe(false); // 101px away
    expect(isNearBottom(viewport(0))).toBe(false);
  });

  test("honours a custom threshold", () => {
    expect(isNearBottom(viewport(550), 200)).toBe(true);
    expect(isNearBottom(viewport(550), 10)).toBe(false);
  });

  test("treats an unmeasured viewport as pinned so the button never flashes", () => {
    expect(
      isNearBottom({ clientHeight: 0, scrollHeight: 0, scrollTop: 0 })
    ).toBe(true);
  });
});

describe("nextArrivalCount", () => {
  test("increments for a peer message while scrolled away", () => {
    expect(nextArrivalCount(0, { isOwn: false, pinned: false })).toBe(1);
    expect(nextArrivalCount(4, { isOwn: false, pinned: false })).toBe(5);
  });

  test("ignores the user's own messages", () => {
    expect(nextArrivalCount(3, { isOwn: true, pinned: false })).toBe(0);
  });

  test("never accrues while pinned at the bottom", () => {
    expect(nextArrivalCount(0, { isOwn: false, pinned: true })).toBe(0);
    // A stale count self-corrects on the next pinned event.
    expect(nextArrivalCount(7, { isOwn: false, pinned: true })).toBe(0);
  });
});

describe("formatArrivalCount", () => {
  test("shows small counts verbatim", () => {
    expect(formatArrivalCount(1)).toBe("1");
    expect(formatArrivalCount(MAX_BADGE_COUNT)).toBe("99");
  });

  test("caps large counts", () => {
    expect(formatArrivalCount(MAX_BADGE_COUNT + 1)).toBe("99+");
    expect(formatArrivalCount(4321)).toBe("99+");
  });
});
