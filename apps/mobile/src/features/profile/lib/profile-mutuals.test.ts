import { expect, test } from "bun:test";

import {
  parseProfileMutuals,
  profileMutualLabel,
} from "@asm/ui/lib/profile-mutuals";

test("older or malformed profiles have empty mutual stacks", () => {
  expect(parseProfileMutuals()).toEqual({
    counts: { followers: 0, following: 0 },
    followers: [],
    following: [],
  });
  expect(
    parseProfileMutuals({
      followers: [null, {}, { id: "a" }],
      following: false,
    })
  ).toEqual({
    counts: { followers: 0, following: 0 },
    followers: [],
    following: [],
  });
});

test("mutual stacks validate identities, cap at three, and preserve totals for overflow", () => {
  const users = Array.from({ length: 8 }, (_, index) => ({
    id: `${index}`,
    username: `user${index}`,
  }));
  const result = parseProfileMutuals({
    followers: [null, users[0], ...users],
    following: users.toReversed(),
  });
  expect(result.followers.map((user) => user.id)).toEqual(["0", "1", "2"]);
  expect(result.following.map((user) => user.id)).toEqual(["7", "6", "5"]);
  expect(result.followers[0]).toEqual({
    ...users[0],
    avatarUrl: null,
    displayName: null,
  });
  expect(result.counts).toEqual({ followers: 8, following: 8 });
  expect(
    profileMutualLabel("followers", result.followers, result.counts.followers)
  ).toContain("and 5 more");
  expect(
    parseProfileMutuals({
      counts: { followers: 12 },
      followers: users.slice(0, 3),
    }).counts.followers
  ).toBe(12);
  expect(
    parseProfileMutuals({
      counts: { followers: -1 },
      followers: users.slice(0, 3),
    }).counts.followers
  ).toBe(3);
  expect(profileMutualLabel("followers", result.followers)).toContain(
    "People you follow who follow this profile"
  );
  expect(profileMutualLabel("following", result.following)).toContain(
    "Accounts you both follow"
  );
});
