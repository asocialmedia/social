import { expect, test } from "bun:test";

import type { PresenceUser } from "./client";
import { selectOnlineFriends } from "./online-friends";

function person(
  id: string,
  overrides: Partial<PresenceUser> = {}
): PresenceUser {
  return {
    avatarUrl: null,
    displayName: id,
    id,
    status: "online",
    username: id,
    ...overrides,
  };
}

test("the strip shows online people the reader follows, and nothing else", () => {
  const users = [
    person("ada", { isFollowing: true }),
    person("grace", { isFollowing: true, status: "idle" }),
    person("alan", { isFollowing: false }),
    person("margaret", { isFollowing: undefined }),
  ];
  expect(selectOnlineFriends(users).map((entry) => entry.id)).toEqual(["ada"]);
  expect(selectOnlineFriends([])).toEqual([]);
});
