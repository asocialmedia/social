import { describe, expect, test } from "bun:test";

import { DEN_AVATAR_FACES_MAX, denAvatarFaces } from "./den-avatar-faces";

function member(id: string, role?: string) {
  return { id, role };
}

describe("denAvatarFaces", () => {
  test("owners lead, then admins, then members", () => {
    const members = [
      member("u-grace", "MEMBER"),
      member("u-me", "ADMIN"),
      member("u-ada", "OWNER"),
    ];
    expect(denAvatarFaces(members, "u-me", 4).map((m) => m.id)).toEqual([
      "u-ada",
      "u-me",
      "u-grace",
    ]);
  });

  test("same-role members keep roster (join) order", () => {
    const members = [member("u-b"), member("u-a")];
    expect(denAvatarFaces(members, "x", 4).map((m) => m.id)).toEqual([
      "u-b",
      "u-a",
    ]);
  });

  test("caps at the limit with the default of three", () => {
    const members = [
      member("u-1"),
      member("u-2"),
      member("u-3"),
      member("u-4"),
      member("u-5"),
    ];
    expect(denAvatarFaces(members).map((m) => m.id)).toEqual([
      "u-1",
      "u-2",
      "u-3",
    ]);
    expect(DEN_AVATAR_FACES_MAX).toBe(3);
  });

  test("unknown roles sort as members", () => {
    const members = [member("u-x", "ELDER"), member("u-o", "OWNER")];
    expect(denAvatarFaces(members, "x", 4).map((m) => m.id)).toEqual([
      "u-o",
      "u-x",
    ]);
  });

  test("a non-positive limit draws nothing", () => {
    expect(denAvatarFaces([member("u-1")], "x", 0)).toEqual([]);
  });
});
