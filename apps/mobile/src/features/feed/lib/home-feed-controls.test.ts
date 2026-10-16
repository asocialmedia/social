import { describe, expect, test } from "bun:test";

import {
  discoveryFeedPress,
  discoveryFleetFeed,
  followingFleetAvatars,
  homeFeedTabs,
} from "@asm/ui/lib/home-feed-controls";

describe("home feed's visible tab order", () => {
  for (const discovery of ["personalized", "trending"] as const) {
    test(`${discovery} occupies one slot before Latest and Following`, () => {
      const feeds = homeFeedTabs(discovery).map((tab) => tab.value);
      expect(feeds).toEqual([discovery, "latest", "following"]);
      expect(feeds[feeds.indexOf("following") - 1]).toBe("latest");
      expect(feeds[feeds.indexOf("latest") - 1]).toBe(discovery);
      expect(feeds[feeds.indexOf(discovery) + 1]).toBe("latest");
      expect(feeds[feeds.indexOf("latest") + 1]).toBe("following");
      expect(feeds[feeds.indexOf(discovery) - 1]).toBeUndefined();
      expect(feeds[feeds.indexOf("following") + 1]).toBeUndefined();
    });
  }

  test("a discovery selection survives a Latest and Following detour", () => {
    const selected = discoveryFleetFeed("trending", "personalized");
    expect(discoveryFleetFeed("latest", selected)).toBe("trending");
    expect(discoveryFleetFeed("following", selected)).toBe("trending");
    expect(discoveryFleetFeed("personalized", selected)).toBe("personalized");
  });
});

describe("home and Gusts discovery trigger", () => {
  for (const selected of ["personalized", "trending", "latest"] as const) {
    test(`only opens a menu when ${selected} is active`, () => {
      expect(discoveryFeedPress(selected, selected)).toEqual({ type: "open" });
      expect(discoveryFeedPress("following", selected)).toEqual({
        feed: selected,
        type: "navigate",
      });
    });
  }
  test("home's inactive discovery tab navigates directly from Latest", () => {
    expect(discoveryFeedPress("latest", "trending")).toEqual({
      feed: "trending",
      type: "navigate",
    });
    expect(discoveryFeedPress("latest", "personalized")).toEqual({
      feed: "personalized",
      type: "navigate",
    });
  });
});

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
