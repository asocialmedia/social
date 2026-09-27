import { describe, expect, it } from "bun:test";

import {
  COMMUNITY_ACCENTS_PALETTE,
  DEFAULT_COMMUNITY_ACCENT,
  resolveCommunityAccentColor,
} from "./community-accents";

describe("resolveCommunityAccentColor", () => {
  it("resolves named accent in dark mode", () => {
    expect(resolveCommunityAccentColor("stone", true)).toBe("#a8a29e");
    expect(resolveCommunityAccentColor("pine", true)).toBe("#34d399");
  });

  it("resolves named accent in light mode", () => {
    expect(resolveCommunityAccentColor("stone", false)).toBe("#57534e");
    expect(resolveCommunityAccentColor("pine", false)).toBe("#047857");
  });

  it("passes through raw hex and rgb values unchanged", () => {
    expect(resolveCommunityAccentColor("#123456", true)).toBe("#123456");
    expect(resolveCommunityAccentColor("rgb(1, 2, 3)", false)).toBe(
      "rgb(1, 2, 3)"
    );
  });

  it("falls back to default slate accent for null, undefined, or unknown keys", () => {
    const defaultDark =
      COMMUNITY_ACCENTS_PALETTE[DEFAULT_COMMUNITY_ACCENT].dark;
    const defaultLight =
      COMMUNITY_ACCENTS_PALETTE[DEFAULT_COMMUNITY_ACCENT].light;

    expect(resolveCommunityAccentColor(null, true)).toBe(defaultDark);
    expect(resolveCommunityAccentColor(undefined, false)).toBe(defaultLight);
    expect(resolveCommunityAccentColor("unknown_color", true)).toBe(
      defaultDark
    );
  });
});
