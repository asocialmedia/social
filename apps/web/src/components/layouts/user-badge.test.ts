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
  test("keeps order and dedupes", () => {
    expect(
      normalizeBadges(["author", "dev", "author", "shitposter", null])
    ).toEqual(["author", "dev", "shitposter"]);
  });

  test("drops unknown values", () => {
    expect(normalizeBadges(["moderator", "dev"])).toEqual(["dev"]);
    expect(normalizeBadges([])).toEqual([]);
    expect(normalizeBadges()).toEqual([]);
  });
});
