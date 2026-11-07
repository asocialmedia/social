// The Follow/Following tone contract with web: Follow is orange, Following
// is the neutral gray, in both themes.
import { describe, expect, test } from "bun:test";

import { followButtonTone } from "./follow-button-tone";

describe("followButtonTone", () => {
  test("Follow wears the orange gradient with white ink", () => {
    for (const isDark of [false, true]) {
      const tone = followButtonTone(isDark, false);
      expect(tone.colors).toEqual(["#ff9500", "#e65500"]);
      expect(tone.textColor).toBe("#ffffff");
      expect(tone.shadows.length).toBeGreaterThan(0);
    }
  });
  test("Following wears the gray recipe with matching ink", () => {
    const light = followButtonTone(false, true);
    expect(light.colors).toEqual(["#f7f8fa", "#e4e7ec"]);
    expect(light.textColor).toBe("#1f2430");
    const dark = followButtonTone(true, true);
    expect(dark.colors).toEqual(["#4a4a4a", "#333333"]);
    expect(dark.textColor).toBe("#ffffff");
  });
  test("dark and light orange shadows differ", () => {
    expect(followButtonTone(false, false).shadows).not.toBe(
      followButtonTone(true, false).shadows
    );
  });
});
