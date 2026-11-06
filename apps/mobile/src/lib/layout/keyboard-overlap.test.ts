import { describe, expect, test } from "bun:test";

import { keyboardOverlap, keyboardScreenTop } from "./keyboard-overlap";

describe("composer keyboard overlap", () => {
  test("edge-to-edge windows lift the composer above the keyboard", () => {
    expect(keyboardOverlap(952, 616)).toBe(336);
  });

  test("a viewport already resized by Android is not shifted a second time", () => {
    expect(keyboardOverlap(616, 616)).toBe(0);
    expect(keyboardOverlap(592, 616)).toBe(0);
  });

  test("screen coordinates include a nested viewport's top inset", () => {
    expect(keyboardOverlap(52 + 900, 616)).toBe(336);
  });

  test("dismissal and keyboards outside the viewport restore the bottom anchor", () => {
    expect(keyboardOverlap(952, null)).toBe(0);
    expect(keyboardOverlap(952, 1000)).toBe(0);
  });

  test("Android's unresized screenY cannot place the bar behind its visible IME", () => {
    const top = keyboardScreenTop({
      bottomInset: 24,
      height: 312,
      platform: "android",
      screenHeight: 952,
      screenY: 952,
    });
    expect(top).toBe(616);
    expect(keyboardOverlap(952, top)).toBe(336);
    expect(keyboardOverlap(616, top)).toBe(0);
  });

  test("valid screenY and iOS floating keyboard coordinates remain authoritative", () => {
    expect(
      keyboardScreenTop({
        bottomInset: 24,
        height: 312,
        platform: "android",
        screenHeight: 952,
        screenY: 616,
      })
    ).toBe(616);
    expect(
      keyboardScreenTop({
        bottomInset: 34,
        height: 300,
        platform: "ios",
        screenHeight: 1024,
        screenY: 500,
      })
    ).toBe(500);
  });
});
