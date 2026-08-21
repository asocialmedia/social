import { describe, expect, test } from "bun:test";

import { normalizeBadge, normalizeBadges } from "./user-badge-utils";

describe("normalizeBadge", () => {
  test("maps known badge values including shitposter", () => {
    expect(normalizeBadge("author")).toBe("author");
    expect(normalizeBadge("DEV")).toBe("dev");
    expect(normalizeBadge("early")).toBe("early");
    expect(normalizeBadge("shitposter")).toBe("shitposter");
    expect(normalizeBadge("Shitposter")).toBe("shitposter");
  });

  test("drops unknown and empty values", () => {
    expect(normalizeBadge("moderator")).toBeNull();
    expect(normalizeBadge("")).toBeNull();
    expect(normalizeBadge(null)).toBeNull();
    expect(normalizeBadge()).toBeNull();
  });
});

describe("normalizeBadges", () => {
  test("sorts by precedence and dedupes", () => {
    expect(
      normalizeBadges(["shitposter", "dev", "author", "early", "author", null])
    ).toEqual(["author", "dev", "early", "shitposter"]);
  });

  test("author leads over early", () => {
    expect(normalizeBadges(["early", "author"])).toEqual(["author", "early"]);
  });

  test("drops unknown values", () => {
    expect(normalizeBadges(["moderator", "dev"])).toEqual(["dev"]);
    expect(normalizeBadges([])).toEqual([]);
    expect(normalizeBadges()).toEqual([]);
  });
});
