import { describe, expect, test } from "bun:test";

import { isMediaActivityVisible } from "./media-activity";

const visibleFeed = {
  active: undefined,
  feedActive: true,
  focused: true,
  foreground: true,
  inViewport: true,
  viewportRequired: true,
};

describe("native image and graphics activity", () => {
  test("feed avatars require their own post to be visible, including long threads", () => {
    expect(isMediaActivityVisible(visibleFeed)).toBe(true);
    expect(isMediaActivityVisible({ ...visibleFeed, inViewport: false })).toBe(
      false
    );
  });

  test("a retained tab cannot animate because another tab shows the same post", () => {
    expect(isMediaActivityVisible({ ...visibleFeed, feedActive: false })).toBe(
      false
    );
    expect(isMediaActivityVisible({ ...visibleFeed, active: false })).toBe(
      false
    );
  });

  test("navigation and backgrounding pause activity independently of visibility", () => {
    expect(isMediaActivityVisible({ ...visibleFeed, focused: false })).toBe(
      false
    );
    expect(isMediaActivityVisible({ ...visibleFeed, foreground: false })).toBe(
      false
    );
  });

  test("detail images work without a feed viewport publisher and pause in background", () => {
    const detail = {
      ...visibleFeed,
      inViewport: false,
      viewportRequired: false,
    };
    expect(isMediaActivityVisible(detail)).toBe(true);
    expect(isMediaActivityVisible({ ...detail, foreground: false })).toBe(
      false
    );
    expect(isMediaActivityVisible({ ...detail, active: true })).toBe(false);
  });
});
