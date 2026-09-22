import { describe, expect, test } from "bun:test";

import {
  reportFeedScroll,
  resetHeaderScroll,
  subscribeHeaderVisibility,
} from "./header-visibility";

describe("header visibility", () => {
  test("hides on scroll down, shows on scroll up or top", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeHeaderVisibility((isHidden) => {
      seen.push(isHidden);
    });
    // Small drifts under the slip threshold never flip.
    reportFeedScroll(10);
    reportFeedScroll(12);
    // Past the threshold scrolling down: hide.
    reportFeedScroll(120);
    // More scrolling down: no repeat notification.
    reportFeedScroll(200);
    // Scrolling up: show.
    reportFeedScroll(150);
    // Hitting the top: stays shown, no repeat.
    reportFeedScroll(0);
    unsubscribe();
    reportFeedScroll(500);
    expect(seen).toEqual([true, false]);
    resetHeaderScroll();
  });
});
