import { describe, expect, test } from "bun:test";

import {
  readSearchCandidates,
  rememberCandidates,
  suggestedCandidates,
} from "./search-candidates";
import type { SearchTarget } from "./search-candidates";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function target(
  id: string,
  overrides: Partial<SearchTarget> = {}
): SearchTarget {
  return {
    displayName: id,
    href: `/users/${id}`,
    id,
    source: "asm",
    type: "user",
    ...overrides,
  };
}

describe("readSearchCandidates", () => {
  test("drops malformed, stale, explicit and community entries", () => {
    const stored = [
      { discoveredAt: NOW, query: "ada", target: target("asm-user-1") },
      {
        discoveredAt: NOW - 8 * DAY,
        query: "old",
        target: target("asm-user-2"),
      },
      {
        discoveredAt: NOW,
        query: "nsfw",
        target: target("asm-post-3", { explicitContent: true, type: "post" }),
      },
      {
        discoveredAt: NOW,
        query: "rust",
        target: target("asm-community-4", { type: "community" }),
      },
      { discoveredAt: NOW, query: "", target: target("asm-user-5") },
      "not an object",
    ];
    expect(
      readSearchCandidates(stored, NOW).map((entry) => entry.target.id)
    ).toEqual(["asm-user-1"]);
  });

  test("returns nothing for a non-array payload", () => {
    expect(readSearchCandidates({ id: "x" }, NOW)).toEqual([]);
  });
});

describe("rememberCandidates", () => {
  test("ignores queries shorter than two characters", () => {
    const current = readSearchCandidates(
      [{ discoveredAt: NOW, query: "ada", target: target("asm-user-1") }],
      NOW
    );
    expect(rememberCandidates(current, [target("asm-user-2")], "a", NOW)).toBe(
      current
    );
  });

  test("prepends new targets and replaces older copies of the same id", () => {
    const current = readSearchCandidates(
      [
        { discoveredAt: NOW - DAY, query: "ada", target: target("asm-user-1") },
        { discoveredAt: NOW - DAY, query: "ada", target: target("asm-user-2") },
      ],
      NOW
    );
    const next = rememberCandidates(
      current,
      [target("asm-user-2"), target("asm-user-3")],
      "  lovelace  ",
      NOW
    );
    expect(next.map((entry) => entry.target.id)).toEqual([
      "asm-user-2",
      "asm-user-3",
      "asm-user-1",
    ]);
    expect(next[0]?.query).toBe("lovelace");
  });
});

describe("suggestedCandidates", () => {
  const candidates = readSearchCandidates(
    [
      { discoveredAt: NOW - 2, query: "ada", target: target("asm-user-1") },
      {
        discoveredAt: NOW - 1,
        query: "ada",
        target: target("bluesky-user-2", {
          href: "/network/bluesky/profile?actor=did%3Aplc%3A2",
          source: "bluesky",
        }),
      },
      {
        discoveredAt: NOW,
        query: "ada",
        target: target("asm-post-3", { href: "/posts/3", type: "post" }),
      },
    ],
    NOW
  );

  test("skips opened targets and orders newest first", () => {
    expect(
      suggestedCandidates(
        candidates,
        new Set(["asm-post-3"]),
        "all",
        "all",
        NOW
      ).map((entry) => entry.target.id)
    ).toEqual(["bluesky-user-2", "asm-user-1"]);
  });

  test("filters by network and kind", () => {
    expect(
      suggestedCandidates(candidates, new Set(), "asm", "user", NOW).map(
        (entry) => entry.target.id
      )
    ).toEqual(["asm-user-1"]);
  });

  test("breaks discovery-time ties by name match strength", () => {
    const tied = readSearchCandidates(
      [
        {
          discoveredAt: NOW,
          query: "ada",
          target: target("asm-user-1", { displayName: "Grace Ada" }),
        },
        {
          discoveredAt: NOW,
          query: "ada",
          target: target("asm-user-2", { displayName: "Ada" }),
        },
      ],
      NOW
    );
    expect(
      suggestedCandidates(tied, new Set(), "all", "all", NOW).map(
        (entry) => entry.target.id
      )
    ).toEqual(["asm-user-2", "asm-user-1"]);
  });
});
