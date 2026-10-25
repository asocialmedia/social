import { describe, expect, it, mock } from "bun:test";

// react-native's entry cannot be evaluated by a bare bun test, so the platform
// is stubbed. The rule under test is a pure function of the platform, so
// stubbing the one value it reads keeps every branch reachable - including the
// native ones this suite never actually runs on.
mock.module("react-native", () => ({ Platform: { OS: "web" } }));

const { SHOWS_SCROLL_INDICATOR, shouldShowScrollIndicator } =
  await import("./scroll-indicator");

// The scroll indicator is a platform decision, not a taste one, and getting it
// backwards is invisible until someone looks at the other target: the native app
// wants no scrollbar on any screen, while the web build needs one because a
// pointer user otherwise has no signal that a region scrolls at all.
describe("scroll indicator visibility", () => {
  it("keeps the indicator on web, where it is the only scroll affordance", () => {
    expect(shouldShowScrollIndicator("web")).toBe(true);
  });

  it("hides the indicator on every native platform", () => {
    for (const platform of ["ios", "android", "macos", "windows"] as const) {
      expect(shouldShowScrollIndicator(platform)).toBe(false);
    }
  });

  it("resolves the constant from the platform it is running on", () => {
    expect(SHOWS_SCROLL_INDICATOR).toBe(true);
  });
});
