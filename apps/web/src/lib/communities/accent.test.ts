import { describe, expect, test } from "bun:test";

import { communityAccentColor, communityAccentStyle } from "./accent";

describe("community accent", () => {
  test("style exposes both theme variables for a known key", () => {
    const style = communityAccentStyle("ember") as Record<string, string>;
    expect(style["--community-accent"]).toMatch(/^#[\da-f]{6}$/i);
    expect(style["--community-accent-dark"]).toMatch(/^#[\da-f]{6}$/i);
  });

  test("unknown keys fall back to the default accent", () => {
    const fallback = communityAccentStyle("nope") as Record<string, string>;
    const slate = communityAccentStyle("slate") as Record<string, string>;
    expect(fallback["--community-accent"]).toBe(slate["--community-accent"]);
  });

  test("color helper picks the theme-appropriate value", () => {
    const dark = communityAccentColor("ember", true);
    const light = communityAccentColor("ember", false);
    expect(dark).toMatch(/^#[\da-f]{6}$/i);
    expect(light).toMatch(/^#[\da-f]{6}$/i);
    expect(dark).not.toBe(light);
  });
});
