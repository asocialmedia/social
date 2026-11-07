import { describe, expect, test } from "bun:test";

import {
  COMMUNITY_BADGE_META,
  isCommunityBadgedRole,
} from "./community-role-badge";

describe("community role badge mapping", () => {
  test("only OWNER, MODERATOR and MEMBER carry a badge", () => {
    expect(isCommunityBadgedRole("OWNER")).toBe(true);
    expect(isCommunityBadgedRole("MODERATOR")).toBe(true);
    expect(isCommunityBadgedRole("MEMBER")).toBe(true);
    expect(isCommunityBadgedRole("PARTICIPANT")).toBe(false);
    expect(isCommunityBadgedRole(null)).toBe(false);
    expect(isCommunityBadgedRole("PARTICIPANT")).toBe(false);
  });
  test("every badged role has a label and a description", () => {
    for (const role of ["MEMBER", "MODERATOR", "OWNER"] as const) {
      expect(COMMUNITY_BADGE_META[role].label.length).toBeGreaterThan(0);
      expect(COMMUNITY_BADGE_META[role].description.length).toBeGreaterThan(0);
    }
  });
});
