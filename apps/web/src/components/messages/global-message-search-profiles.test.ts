import { describe, expect, test } from "bun:test";

import type { SearchUserResult } from "@/lib/messages/client";

import {
  getVisibleProfileSearchResults,
  rankProfileSearchResults,
} from "./global-message-search-profiles";

function createProfiles(count: number): SearchUserResult[] {
  return Array.from({ length: count }, (_, index) => ({
    addRefusal: null,
    avatarUrl: null,
    badge: null,
    badges: [],
    displayName: `Profile ${index + 1}`,
    hasIdentity: true,
    id: `profile-${index + 1}`,
    username: `profile${index + 1}`,
  }));
}

describe("global message search profile results", () => {
  test("shows the first five profiles before expansion", () => {
    const visible = getVisibleProfileSearchResults(createProfiles(9), false);

    expect(visible).toHaveLength(5);
    expect(visible[0]?.id).toBe("profile-1");
    expect(visible[4]?.id).toBe("profile-5");
  });

  test("shows every bounded profile result after expansion", () => {
    const profiles = createProfiles(9);
    const visible = getVisibleProfileSearchResults(profiles, true);

    expect(visible).toHaveLength(9);
    expect(visible).toEqual(profiles);
  });

  test("ranks exact and prefix profile matches before partial matches", () => {
    const [prefix, exact, partial] = createProfiles(3);
    if (!prefix || !exact || !partial) {
      throw new Error("Expected three profile fixtures");
    }
    prefix.displayName = "Ada's friend";
    exact.displayName = "Ada";
    partial.displayName = "My Ada contact";
    const profiles = [prefix, exact, partial];

    const ranked = rankProfileSearchResults(profiles, "ada");

    expect(ranked.map((profile) => profile.id)).toEqual([
      "profile-2",
      "profile-1",
      "profile-3",
    ]);
  });
});
