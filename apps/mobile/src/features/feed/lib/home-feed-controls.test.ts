import { describe, expect, test } from "bun:test";

import {
  discoveryFleetFeed,
  followingFleetAvatars,
} from "@asm/ui/lib/home-feed-controls";

const people = ["a", "b", "c", "d"].map((id) => ({
  avatarUrl: `${id}.png`,
  id,
}));

describe("home feed controls", () => {
  test("explicit discovery feeds override memory; Latest and Following retain it", () => {
    expect(discoveryFleetFeed("trending", "personalized")).toBe("trending");
    expect(discoveryFleetFeed("personalized", "trending")).toBe("personalized");
    expect(discoveryFleetFeed("following", "trending")).toBe("trending");
    expect(discoveryFleetFeed("latest", "personalized")).toBe("personalized");
  });
  test("avatars follow fleet order, exclude unfollowed authors and deduplicate", () => {
    expect(
      followingFleetAvatars(
        [
          { userId: "c" },
          { userId: "stranger" },
          { userId: "c" },
          { userId: "b" },
        ],
        people
      ).map((person) => person.id)
    ).toEqual(["c", "b", "a"]);
  });
  test("empty feeds still identify followed people and empty following stays empty", () => {
    expect(
      followingFleetAvatars([], people).map((person) => person.id)
    ).toEqual(["a", "b", "c"]);
    expect(followingFleetAvatars([{ userId: "stranger" }], [])).toEqual([]);
  });
});
