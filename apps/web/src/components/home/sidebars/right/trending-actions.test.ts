import { describe, expect, test } from "bun:test";

import { selectTopAuraUsers } from "./trending-utils";
import type { TrendingAuraUser, TrendingMention } from "./trending-utils";

const auraUser = (
  id: string,
  aura: number,
  badges: string[] = []
): TrendingAuraUser => ({
  aura,
  avatarUrl: null,
  badge: badges[0] ?? null,
  badges,
  displayName: `User ${id}`,
  type: "aura",
  userId: id,
  username: id,
});

const mention = (userId: string, badges: string[] = []): TrendingMention => ({
  avatarUrl: null,
  badge: badges[0] ?? null,
  badges,
  count: 5,
  displayName: `User ${userId}`,
  type: "mention",
  userId,
  username: userId,
});

describe("selectTopAuraUsers", () => {
  test("returns the top three by aura when nothing overlaps with mentions", () => {
    const topAura = [
      auraUser("a", 300),
      auraUser("b", 200),
      auraUser("c", 100),
    ];

    const result = selectTopAuraUsers(topAura, []);

    expect(result.map((user) => user.userId)).toEqual(["a", "b", "c"]);
  });

  test("preserves non-null badges like dev and author on selected users", () => {
    const topAura = [
      auraUser("a", 300, ["dev"]),
      auraUser("b", 200, ["author"]),
      auraUser("c", 100, []),
    ];

    const result = selectTopAuraUsers(topAura, []);

    expect(result.map((user) => user.badges)).toEqual([
      ["dev"],
      ["author"],
      [],
    ]);
  });

  test("skips users already shown as mentions and backfills to three", () => {
    const topAura = [
      auraUser("a", 300),
      auraUser("b", 200),
      auraUser("c", 100),
      auraUser("d", 50),
      auraUser("e", 10),
    ];

    const result = selectTopAuraUsers(topAura, [mention("a"), mention("b")]);

    expect(result.map((user) => user.userId)).toEqual(["c", "d", "e"]);
  });

  test("stays at three when a non-top mention overlaps with an aura entry", () => {
    const topAura = [
      auraUser("a", 300),
      auraUser("b", 200),
      auraUser("c", 100),
    ];

    const result = selectTopAuraUsers(topAura, [mention("c")]);

    expect(result.map((user) => user.userId)).toEqual(["a", "b"]);
  });

  test("returns what remains when candidates run out", () => {
    const topAura = [auraUser("a", 300), auraUser("b", 200)];

    const result = selectTopAuraUsers(topAura, []);

    expect(result.map((user) => user.userId)).toEqual(["a", "b"]);
  });
});
