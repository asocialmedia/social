import { describe, expect, test } from "bun:test";

import { interleaveExploreStream } from "./explore-interleave";

function kinds(items: { kind: string }[]): string {
  return items.map((item) => item.kind[0]).join("");
}

describe("explore stream interleave", () => {
  const posts = Array.from({ length: 13 }, (_, index) => `p${index}`);

  test("outside search every sixth post is followed by an account", () => {
    const items = interleaveExploreStream(posts, [], ["a0", "a1", "a2"], false);
    expect(kinds(items)).toBe("ppppppappppppap");
    expect(items[6]).toEqual({ account: "a0", kind: "account" });
    expect(items[13]).toEqual({ account: "a1", kind: "account" });
  });

  test("search results put a user in every sixth slot and skip accounts", () => {
    const items = interleaveExploreStream(
      posts.slice(0, 10),
      ["u0", "u1", "u2"],
      ["a0"],
      true
    );
    expect(items[5]).toEqual({ kind: "user", user: "u0" });
    expect(items[11]).toEqual({ kind: "user", user: "u1" });
    // The user that never reached a slot is appended after the posts.
    expect(items.at(-1)).toEqual({ kind: "user", user: "u2" });
    expect(items.some((item) => item.kind === "account")).toBe(false);
  });

  test("an empty post list still lists the users", () => {
    expect(interleaveExploreStream([], ["u0"], ["a0"], false)).toEqual([
      { kind: "user", user: "u0" },
    ]);
  });
});
