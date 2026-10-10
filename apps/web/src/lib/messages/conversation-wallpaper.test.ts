import { describe, expect, test } from "bun:test";

import {
  CONVERSATION_WALLPAPERS,
  DEFAULT_WALLPAPER_DIM,
  isConversationWallpaperKey,
  isWallpaperDim,
  MAX_WALLPAPER_DIM,
  MIN_WALLPAPER_DIM,
  resolveConversationWallpaper,
  resolveWallpaperDim,
  wallpaperDimOverlay,
} from "./conversation-wallpaper";

describe("conversation wallpapers", () => {
  test("keys are unique, so a stored key resolves to exactly one wallpaper", () => {
    const keys = CONVERSATION_WALLPAPERS.map((wallpaper) => wallpaper.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every wallpaper carries the label and served URL its swatch reads", () => {
    for (const wallpaper of CONVERSATION_WALLPAPERS) {
      expect(wallpaper.label.length).toBeGreaterThan(0);
      // The swatch and the transcript both paint this, so an empty src would
      // render a chat with no wallpaper and no way to see why.
      expect(wallpaper.src.length).toBeGreaterThan(0);
    }
  });

  test("isConversationWallpaperKey accepts a known key and rejects anything else", () => {
    expect(isConversationWallpaperKey(CONVERSATION_WALLPAPERS[0]?.key)).toBe(
      true
    );
    expect(isConversationWallpaperKey("chartreuse")).toBe(false);
    expect(isConversationWallpaperKey(null)).toBe(false);
    expect(isConversationWallpaperKey(7)).toBe(false);
  });

  test("a cleared key resolves to no wallpaper at all", () => {
    // The default is the plain app background, the way a chat looked before
    // wallpapers existed. This is the case the theme table cannot have, because
    // a theme always resolves to something.
    expect(resolveConversationWallpaper(null)).toBeNull();
    expect(resolveConversationWallpaper()).toBeNull();
  });

  test("an unknown key resolves to no wallpaper, never to the wrong art", () => {
    // A key can come from a client newer than this build. Painting the plain
    // background is the safe degradation; falling back to some other wallpaper
    // would show art the member never picked.
    expect(resolveConversationWallpaper("from-the-future")).toBeNull();
  });

  test("a known key resolves to its own wallpaper", () => {
    for (const wallpaper of CONVERSATION_WALLPAPERS) {
      expect(resolveConversationWallpaper(wallpaper.key)).toEqual(wallpaper);
    }
  });
});

describe("wallpaper dim", () => {
  test("the default sits inside the range and leaves a bubble readable", () => {
    expect(DEFAULT_WALLPAPER_DIM).toBeGreaterThanOrEqual(MIN_WALLPAPER_DIM);
    expect(DEFAULT_WALLPAPER_DIM).toBeLessThanOrEqual(MAX_WALLPAPER_DIM);
  });

  test("isWallpaperDim accepts a whole percentage and rejects anything else", () => {
    expect(isWallpaperDim(MIN_WALLPAPER_DIM)).toBe(true);
    expect(isWallpaperDim(MAX_WALLPAPER_DIM)).toBe(true);
    expect(isWallpaperDim(DEFAULT_WALLPAPER_DIM)).toBe(true);
    // A value the picker cannot represent must not be stored: the slider is
    // whole-percent, and a row the picker cannot show is a row it cannot undo.
    expect(isWallpaperDim(1.5)).toBe(false);
    expect(isWallpaperDim(-1)).toBe(false);
    expect(isWallpaperDim(MAX_WALLPAPER_DIM + 1)).toBe(false);
    expect(isWallpaperDim(null)).toBe(false);
    expect(isWallpaperDim("40")).toBe(false);
    expect(isWallpaperDim(Number.NaN)).toBe(false);
  });

  test("a cleared dim resolves to the default, and an out-of-range one clamps", () => {
    // Cleared is the app default. Out of range clamps rather than jumping to the
    // default, so a row written by a build with a wider range still paints.
    expect(resolveWallpaperDim(null)).toBe(DEFAULT_WALLPAPER_DIM);
    expect(resolveWallpaperDim()).toBe(DEFAULT_WALLPAPER_DIM);
    expect(resolveWallpaperDim(MAX_WALLPAPER_DIM + 50)).toBe(MAX_WALLPAPER_DIM);
    expect(resolveWallpaperDim(-50)).toBe(MIN_WALLPAPER_DIM);
    expect(resolveWallpaperDim(63)).toBe(63);
  });

  test("a dim of 0 paints no overlay at all", () => {
    // An undimmed chat should not carry a full-transcript compositing layer for
    // no visible change, so the invisible stop is null, not rgba(0,0,0,0).
    expect(wallpaperDimOverlay(0)).toBeNull();
  });

  test("every dim above 0 paints an overlay that darkens as it rises", () => {
    expect(wallpaperDimOverlay(1)).toBe("rgba(0, 0, 0, 0.01)");
    expect(wallpaperDimOverlay(DEFAULT_WALLPAPER_DIM)).toBe(
      "rgba(0, 0, 0, 0.4)"
    );
    expect(wallpaperDimOverlay(MAX_WALLPAPER_DIM)).toBe("rgba(0, 0, 0, 1)");
  });

  test("the overlay is strictly darker for every step up the slider", () => {
    let previous = -1;
    for (let dim = MIN_WALLPAPER_DIM; dim <= MAX_WALLPAPER_DIM; dim += 1) {
      const overlay = wallpaperDimOverlay(dim);
      if (overlay === null) {
        continue;
      }
      const match = /rgba\(0, 0, 0, (?<opacity>[\d.]+)\)/u.exec(overlay);
      expect(match).not.toBeNull();
      const opacity = Number(match?.groups?.opacity);
      expect(opacity).toBeGreaterThan(previous);
      previous = opacity;
    }
  });
});
