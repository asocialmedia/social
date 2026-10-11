import { describe, expect, test } from "bun:test";

import {
  advanceGustHeader,
  followingGustAvatars,
  gustFeedIndicator,
} from "@asm/ui/lib/gust-header";

describe("Gust feed indicator geometry", () => {
  test("centers the narrow discovery and wider Following bars under their labels", () => {
    expect(gustFeedIndicator({ width: 80, x: 0 }, false)).toEqual({
      width: 24,
      x: 28,
    });
    expect(gustFeedIndicator({ width: 70, x: 90 }, true)).toEqual({
      width: 48,
      x: 101,
    });
  });
  test("repositions when the discovery label or accessibility text size changes", () => {
    expect(gustFeedIndicator({ width: 100, x: 120 }, true)).toEqual({
      width: 48,
      x: 146,
    });
    expect(gustFeedIndicator({ width: 100, x: 0 }, false)).toEqual({
      width: 24,
      x: 38,
    });
  });
});

describe("Gust header direction", () => {
  test("hides down, shows on reversing before reaching the previous Gust, and stays shown at the first Gust", () => {
    let state = { anchor: 0, visible: true };
    state = advanceGustHeader(12, state);
    expect(state.visible).toBe(false);
    state = advanceGustHeader(800, state);
    expect(state.visible).toBe(false);
    state = advanceGustHeader(788, state);
    expect(state.visible).toBe(true);
    expect(advanceGustHeader(0, state)).toEqual({ anchor: 0, visible: true });
    expect(advanceGustHeader(-20, state).visible).toBe(true);
  });
  test("ignores subpixel settling noise and accumulates movement", () => {
    const hidden = { anchor: 800, visible: false };
    expect(advanceGustHeader(799, hidden)).toBe(hidden);
    expect(advanceGustHeader(795, hidden)).toBe(hidden);
    expect(advanceGustHeader(790, hidden).visible).toBe(true);
  });
});

test("Following avatars lead with the visible author or amplifier, deduplicate, and follow the next clips", () => {
  const a = { avatarUrl: null, id: "a" };
  const b = { avatarUrl: null, id: "b" };
  const c = { avatarUrl: null, id: "c" };
  const posts = [
    { followingSources: [a, b] },
    { followingSources: [b] },
    { followingSources: [c, b] },
  ];
  expect(followingGustAvatars(posts).map((person) => person.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(followingGustAvatars(posts, 1).map((person) => person.id)).toEqual([
    "b",
    "c",
    "a",
  ]);
  expect(followingGustAvatars(posts, 2, 2).map((person) => person.id)).toEqual([
    "c",
    "b",
  ]);
  expect(followingGustAvatars([{}])).toEqual([]);
});
