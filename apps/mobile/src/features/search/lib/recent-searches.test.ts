import { describe, expect, test } from "bun:test";

import { recentLabel, rememberRecent } from "./recent-searches";

interface Entry {
  href?: string;
  id?: string;
  query: string;
  source: string;
}

const typed = (query: string, source = "all"): Entry => ({ query, source });
const opened = (id: string, query: string): Entry => ({
  href: `/users/${id}`,
  id: `asm-user-${id}`,
  query,
  source: "asm",
});

describe("recent searches", () => {
  test("an opened profile replaces the typed query that found it", () => {
    const next = rememberRecent(
      [typed("Alice"), typed("bob")],
      opened("alice", "alice")
    );
    expect(next.map((entry) => entry.query)).toEqual(["alice", "bob"]);
    expect(next[0]?.href).toBe("/users/alice");
  });

  test("reopening a result moves it to the top instead of duplicating it", () => {
    const next = rememberRecent(
      [opened("bob", "bob"), opened("alice", "al")],
      opened("alice", "alice")
    );
    expect(next.map((entry) => entry.id)).toEqual([
      "asm-user-alice",
      "asm-user-bob",
    ]);
  });

  test("a typed query dedupes case-insensitively per network and keeps results", () => {
    const next = rememberRecent(
      [typed("Cats"), typed("cats", "bluesky"), opened("cats", "cats")],
      typed("cats")
    );
    expect(next).toHaveLength(3);
    expect(next.filter((entry) => !("href" in entry))).toHaveLength(2);
  });

  test("keeps the newest ten", () => {
    const many = Array.from({ length: 12 }, (_, index) => typed(`q${index}`));
    expect(rememberRecent(many, typed("new"))).toHaveLength(10);
  });

  test("sensitive posts are labelled, never quoted", () => {
    expect(recentLabel("nsfw text", true)).toBe("Sensitive post");
    expect(recentLabel("hello", false)).toBe("hello");
  });
});
