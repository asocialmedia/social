import { describe, expect, test } from "bun:test";

import {
  BADGE_PRECEDENCE,
  badgeRank,
  normalizeBadge,
  normalizeBadges,
} from "./user-badge-utils";

describe("normalizeBadge", () => {
  test("maps known badge values including shitposter", () => {
    expect(normalizeBadge("author")).toBe("author");
    expect(normalizeBadge("DEV")).toBe("dev");
    expect(normalizeBadge("early")).toBe("early");
    expect(normalizeBadge("shitposter")).toBe("shitposter");
    expect(normalizeBadge("Shitposter")).toBe("shitposter");
    expect(normalizeBadge("trending")).toBe("trending");
  });

  test("drops unknown and empty values", () => {
    expect(normalizeBadge("moderator")).toBeNull();
    expect(normalizeBadge("")).toBeNull();
    expect(normalizeBadge(null)).toBeNull();
    expect(normalizeBadge()).toBeNull();
  });
});

describe("badgeRank", () => {
  test("orders both families on one table", () => {
    // The committed display order across platform badges AND community roles:
    // author -> owner -> moderator -> dev -> shitposter -> member -> early.
    expect(BADGE_PRECEDENCE).toEqual([
      "author",
      "owner",
      "moderator",
      "dev",
      "shitposter",
      "member",
      "early",
      "trending",
    ]);

    const ordered = [
      "author",
      "owner",
      "moderator",
      "dev",
      "shitposter",
      "member",
      "early",
      "trending",
    ];
    const ranks = ordered.map((key) => badgeRank(key));
    expect(ranks).toEqual([...ranks].toSorted((a, b) => a - b));
  });

  test("a community owner outranks a developer", () => {
    // The point of a shared table: roles are not all-after all platform badges.
    expect(badgeRank("owner")).toBeLessThan(badgeRank("dev"));
    expect(badgeRank("moderator")).toBeLessThan(badgeRank("dev"));
    expect(badgeRank("member")).toBeLessThan(badgeRank("early"));
  });

  test("unknown keys sort last", () => {
    const unknown = badgeRank("something-new");
    for (const key of BADGE_PRECEDENCE) {
      expect(badgeRank(key)).toBeLessThan(unknown);
    }
  });

  test("is case-insensitive, so uppercase role values rank correctly", () => {
    // Community roles are stored uppercase; the table is lowercase. A mismatch
    // here silently sorts every role last, which is the bug this guards.
    expect(badgeRank("OWNER")).toBe(badgeRank("owner"));
    expect(badgeRank("MODERATOR")).toBe(badgeRank("moderator"));
    expect(badgeRank("MEMBER")).toBe(badgeRank("member"));
  });
});

describe("normalizeBadges", () => {
  test("sorts by precedence and dedupes", () => {
    expect(
      normalizeBadges([
        "trending",
        "shitposter",
        "dev",
        "author",
        "early",
        "author",
        null,
      ])
    ).toEqual(["author", "dev", "shitposter", "early", "trending"]);
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
