import { describe, expect, test } from "bun:test";

import {
  reportFeedScroll,
  resetHeaderScroll,
  subscribeHeaderVisibility,
} from "./header-visibility";

describe("header visibility", () => {
  test("reveals after reversing deep in the feed and hides after the next reversal", () => {
    resetHeaderScroll();
    const seen: boolean[] = [];
    const unsubscribe = subscribeHeaderVisibility((value) => seen.push(value));
    reportFeedScroll(120);
    reportFeedScroll(4000);
    reportFeedScroll(3996);
    reportFeedScroll(3992);
    expect(seen).toEqual([true]);
    reportFeedScroll(3984);
    expect(seen).toEqual([true, false]);
    reportFeedScroll(3000);
    reportFeedScroll(3008);
    expect(seen).toEqual([true, false]);
    reportFeedScroll(3016);
    expect(seen).toEqual([true, false, true]);
    unsubscribe();
    resetHeaderScroll();
  });

  test("restoring a deep offset does not immediately hide controls", () => {
    resetHeaderScroll(4000);
    const seen: boolean[] = [];
    const unsubscribe = subscribeHeaderVisibility((value) => seen.push(value));
    reportFeedScroll(4000);
    reportFeedScroll(3990);
    expect(seen).toEqual([]);
    reportFeedScroll(4010);
    expect(seen).toEqual([true]);
    unsubscribe();
    resetHeaderScroll();
  });
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

  // The bug this pins: each step below is under HIDE_SLIP, so comparing only
  // consecutive offsets never hid the header however far the feed travelled.
  test("accumulates many small downward steps into a hide", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeHeaderVisibility((isHidden) => {
      seen.push(isHidden);
    });

    let offset = 0;
    // 4px steps, all below the 12px slip, walking past HIDE_AFTER.
    for (let step = 0; step < 60; step += 1) {
      offset += 4;
      reportFeedScroll(offset);
    }
    // Same again in reverse, to bring it back.
    for (let step = 0; step < 60; step += 1) {
      offset -= 4;
      reportFeedScroll(offset);
    }

    expect(seen).toEqual([true, false]);
    unsubscribe();
    resetHeaderScroll();
  });

  test("small jitter around the threshold does not flip the header", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeHeaderVisibility((isHidden) => {
      seen.push(isHidden);
    });

    // Park short of HIDE_AFTER, where a few pixels of travel cannot hide, then
    // nudge by less than the slip each time.
    reportFeedScroll(80);
    reportFeedScroll(88);
    reportFeedScroll(82);
    reportFeedScroll(90);

    expect(seen).toEqual([]);
    unsubscribe();
    resetHeaderScroll();
  });

  test("a single jump past HIDE_AFTER still hides immediately", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeHeaderVisibility((isHidden) => {
      seen.push(isHidden);
    });

    resetHeaderScroll();
    reportFeedScroll(150);

    expect(seen).toEqual([true]);
    unsubscribe();
    resetHeaderScroll();
  });
});
