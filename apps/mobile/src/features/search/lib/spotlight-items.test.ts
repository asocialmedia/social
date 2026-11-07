import { describe, expect, test } from "bun:test";

import type { DiscoverySuggestions } from "@asm/protocols/discovery";

import type { SpotlightResponse } from "./search-api";
import { readSearchCandidates } from "./search-candidates";
import {
  emptySearchCopy,
  localRecentItem,
  matchingServerEntry,
  mergeRecentHistory,
  searchPlaceholder,
  spotlightGroups,
  spotlightInterests,
  spotlightResultItems,
  spotlightTarget,
  suggestedItems,
} from "./spotlight-items";
import type { LocalRecentSearch, ServerHistoryEntry } from "./spotlight-items";

const NOW = 1_800_000_000_000;

const asm: SpotlightResponse = {
  communities: [
    {
      accentColor: "#ff9500",
      avatarUrl: null,
      id: "c1",
      memberCount: 1520,
      name: "Rustaceans",
      slug: "rust",
    },
  ],
  posts: [
    {
      aura: 0,
      authorAvatarUrl: null,
      authorDisplayName: "Ada",
      authorUsername: "ada",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      explicitContent: false,
      id: "p1",
      isGust: false,
      previewMedia: null,
      viewCount: 0,
    },
    {
      aura: 0,
      authorAvatarUrl: null,
      authorDisplayName: "Ada",
      authorUsername: "ada",
      content: "spicy",
      createdAt: "2026-01-01T00:00:00.000Z",
      explicitContent: true,
      id: "g1",
      isGust: true,
      previewMedia: null,
      viewCount: 0,
    },
  ],
  users: [
    {
      aura: 1,
      avatarUrl: null,
      badge: null,
      badges: [],
      bio: null,
      displayName: "",
      id: "u1",
      username: "ada",
    },
  ],
};

const bluesky = {
  posts: [{ author: { handle: "bob.bsky.social" }, id: "at://post", text: "" }],
  profiles: [{ displayName: "", handle: "bob.bsky.social", id: "did:plc:bob" }],
};

describe("spotlightResultItems", () => {
  test("orders ASM accounts, Bluesky profiles, ASM posts, Bluesky posts, communities", () => {
    const items = spotlightResultItems(asm, bluesky, "all");
    expect(items.map((item) => item.id)).toEqual([
      "asm-user-u1",
      "bluesky-user-did:plc:bob",
      "asm-post-p1",
      "asm-post-g1",
      "bluesky-post-at://post",
      "asm-community-c1",
    ]);
  });

  test("uses web's titles and subtitles", () => {
    const [user, profile, post, sensitive, external, community] =
      spotlightResultItems(asm, bluesky, "all");
    expect(user?.displayName).toBe("ada");
    expect(user?.subtitle).toBe("@ada");
    expect(user?.href).toBe("/users/ada");
    expect(profile?.displayName).toBe("bob.bsky.social");
    expect(profile?.href).toBe(
      "/network/bluesky/profile?actor=did%3Aplc%3Abob"
    );
    expect(post?.displayName).toBe("Media post");
    expect(post?.subtitle).toBe("@ada");
    expect(sensitive?.displayName).toBe("Sensitive post");
    expect(sensitive?.href).toBe("/gusts?id=g1");
    expect(external?.displayName).toBe("Media post");
    expect(community?.subtitle).toBe("a/rust · 1.5k members");
  });

  test("narrows to the chosen kind", () => {
    expect(
      spotlightResultItems(asm, bluesky, "post").map((item) => item.type)
    ).toEqual(["post", "post", "post"]);
  });
});

describe("spotlightGroups", () => {
  const results = spotlightResultItems(asm, bluesky, "all");

  test("groups a 2+ character query into accounts, posts and communities", () => {
    const groups = spotlightGroups("ad", results, [], []);
    expect(groups.map((group) => [group.title, group.items.length])).toEqual([
      ["Accounts", 2],
      ["Posts", 3],
      ["Communities", 1],
    ]);
  });

  test("shows nothing for a single character", () => {
    expect(spotlightGroups("a", results, [], [])).toEqual([]);
  });

  test("caps suggested accounts at six and posts at four on an empty query", () => {
    const suggested = [
      ...Array.from({ length: 8 }, (_, index) => ({
        displayName: `u${index}`,
        href: `/users/u${index}`,
        id: `asm-user-${index}`,
        type: "user" as const,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        displayName: `p${index}`,
        href: `/posts/p${index}`,
        id: `asm-post-${index}`,
        type: "post" as const,
      })),
    ];
    const groups = spotlightGroups("", results, [], suggested);
    expect(groups.map((group) => [group.title, group.items.length])).toEqual([
      ["Recent", 0],
      ["Suggested accounts", 6],
      ["Suggested posts", 4],
    ]);
  });
});

describe("mergeRecentHistory", () => {
  const local: LocalRecentSearch[] = [
    {
      at: NOW - 10,
      href: "/users/ada",
      id: "asm-user-u1",
      kind: "all",
      label: "Ada",
      query: "ada",
      source: "asm",
      subtitle: "@ada",
      type: "user",
    },
    { at: NOW - 30, kind: "all", query: "rust", source: "all" },
  ];
  const server: ServerHistoryEntry[] = [
    {
      item: {
        searchedAt: NOW - 5,
        type: "user",
        user: { id: "u1", username: "ada" },
      },
      key: "server-user",
    },
    {
      item: { query: "Rust", searchedAt: NOW, type: "query" },
      key: "server-rust",
    },
    {
      item: { query: "zig", searchedAt: NOW - 20, type: "query" },
      key: "server-zig",
    },
    {
      item: {
        post: {
          content: "hello",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p9",
        },
        searchedAt: NOW - 1,
        type: "post",
      },
      key: "server-post",
    },
  ];

  test("merges device and server history newest first without duplicates", () => {
    const merged = mergeRecentHistory(local, server, "all", "all");
    expect(merged.map((item) => item.id)).toEqual([
      "asm-post-p9",
      "asm-user-u1",
      "query:asm:zig",
      "query:all:rust",
    ]);
    expect(merged[1]?.localHistoryAt).toBe(NOW - 10);
    expect(merged[2]?.serverRemoveTarget).toBe("server-zig");
  });

  test("filters by network and kind", () => {
    expect(
      mergeRecentHistory(local, server, "bluesky", "all").map((item) => item.id)
    ).toEqual(["query:all:rust"]);
    expect(
      mergeRecentHistory(local, server, "all", "user").map((item) => item.id)
    ).toEqual(["asm-user-u1"]);
  });

  test("caps the list at ten", () => {
    const many: LocalRecentSearch[] = Array.from(
      { length: 14 },
      (_, index) => ({
        at: NOW - index,
        kind: "all",
        query: `q${index}`,
        source: "all",
      })
    );
    expect(mergeRecentHistory(many, [], "all", "all")).toHaveLength(10);
  });

  test("finds the server entry behind a device row", () => {
    const [user] = mergeRecentHistory(local, [], "all", "user");
    expect(user ? matchingServerEntry(user, server)?.key : undefined).toBe(
      "server-user"
    );
  });
});

describe("localRecentItem", () => {
  test("classifies entries stored before targets carried a type", () => {
    expect(
      localRecentItem({
        at: NOW,
        href: "/network/bluesky/profile?actor=did%3Aplc%3Abob",
        kind: "all",
        label: "Bob",
        query: "bob",
        source: "all",
      })
    ).toMatchObject({ source: "bluesky", type: "user" });
    expect(
      localRecentItem({
        at: NOW,
        href: "/a/rust",
        kind: "all",
        label: "Rust",
        query: "rust",
        source: "asm",
      }).type
    ).toBe("community");
  });
});

describe("suggestedItems", () => {
  const data: DiscoverySuggestions = {
    accounts: [
      {
        avatarUrl: null,
        displayName: "Ada",
        followers: 3,
        following: false,
        handle: "ada",
        href: "/ada",
        id: "u1",
        reason: "Popular in Rust",
        source: "asm",
      },
      {
        avatarUrl: null,
        displayName: "Bob",
        followers: 3,
        following: false,
        handle: "bob.bsky.social",
        href: "/network/bluesky/profile?actor=did%3Aplc%3Abob",
        id: "did:plc:bob",
        reason: "Followed by friends",
        source: "bluesky",
      },
    ],
    partial: false,
    posts: [
      {
        authorId: "u1",
        avatarUrl: null,
        displayName: "Hello",
        href: "/posts/abcd1234-hello",
        id: "abcd1234-full-id",
        reason: "Trending",
        source: "asm",
        subtitle: "@ada",
      },
    ],
    profileId: "default",
  };

  test("maps server suggestions for signed-in viewers", () => {
    const items = suggestedItems({
      candidates: [],
      data,
      kind: "all",
      local: [],
      signedIn: true,
      source: "all",
    });
    expect(items.map((item) => [item.id, item.href])).toEqual([
      ["asm-user-u1", "/users/ada"],
      [
        "bluesky-user-did:plc:bob",
        "/network/bluesky/profile?actor=did%3Aplc%3Abob",
      ],
      ["asm-post-abcd1234-full-id", "/posts/abcd1234-full-id"],
    ]);
    expect(items[0]?.recommendedAccount?.handle).toBe("ada");
  });

  test("shows nothing while a signed-in viewer's suggestions load", () => {
    expect(
      suggestedItems({
        candidates: [],
        data: undefined,
        kind: "all",
        local: [],
        signedIn: true,
        source: "all",
      })
    ).toEqual([]);
  });

  test("offers guests the unopened results their searches surfaced", () => {
    const candidates = readSearchCandidates(
      [
        {
          discoveredAt: NOW,
          query: "ada",
          target: {
            displayName: "Ada",
            href: "/users/ada",
            id: "asm-user-u1",
            source: "asm",
            type: "user",
          },
        },
        {
          discoveredAt: NOW,
          query: "grace",
          target: {
            displayName: "Grace",
            href: "/users/grace",
            id: "asm-user-u2",
            source: "asm",
            type: "user",
          },
        },
      ],
      NOW
    );
    const items = suggestedItems({
      candidates,
      data,
      kind: "all",
      local: [
        {
          at: NOW,
          href: "/users/ada",
          id: "asm-user-u1",
          kind: "all",
          query: "ada",
          source: "asm",
        },
      ],
      now: NOW,
      signedIn: false,
      source: "all",
    });
    expect(items.map((item) => [item.id, item.reason])).toEqual([
      ["asm-user-u2", "From “grace”"],
    ]);
  });
});

describe("spotlightInterests", () => {
  test("combines profile, learned and related interests, capped at ten", () => {
    expect(
      spotlightInterests({
        persona: {
          learnedInterests: ["Rust", "Zig"],
          relatedInterests: ["Go", "", "Rust"],
        },
        preferences: {
          activeProfileId: "work",
          profiles: [
            { id: "home", interests: ["Cats"] },
            { id: "work", interests: ["Rust", "Design"] },
          ],
        },
      })
    ).toEqual(["Rust", "Design", "Zig", "Go"]);
  });

  test("falls back to web's starter topics", () => {
    expect(
      spotlightInterests({
        persona: { learnedInterests: [], relatedInterests: [] },
        preferences: { activeProfileId: "x", profiles: [] },
      })
    ).toEqual([
      "Technology",
      "Design",
      "Music",
      "Photography",
      "Gaming",
      "Science",
    ]);
  });
});

describe("copy", () => {
  test("placeholders follow the network", () => {
    expect(searchPlaceholder("bluesky")).toBe(
      "Search Bluesky accounts and posts"
    );
    expect(searchPlaceholder("asm")).toBe(
      "Search asocialmedia accounts, posts, communities"
    );
    expect(searchPlaceholder("all")).toBe(
      "Search accounts, posts, communities across networks"
    );
  });

  test("picks web's empty states", () => {
    const base = {
      errorCount: 0,
      fetching: false,
      itemCount: 0,
      kind: "all" as const,
    };
    expect(emptySearchCopy({ ...base, trimmed: "a" })?.title).toBe(
      "Keep typing"
    );
    expect(emptySearchCopy({ ...base, trimmed: "ada" })?.title).toBe(
      "No results for “ada”"
    );
    expect(
      emptySearchCopy({ ...base, fetching: true, trimmed: "ada" })
    ).toBeNull();
    expect(
      emptySearchCopy({ ...base, errorCount: 1, trimmed: "ada" })
    ).toBeNull();
    expect(emptySearchCopy({ ...base, trimmed: "" })?.title).toBe(
      "Find your next connection"
    );
    expect(
      emptySearchCopy({ ...base, kind: "post", trimmed: "" })?.description
    ).toBe(
      "Search to find results, or choose Everything in filters to see all your recent activity."
    );
    expect(emptySearchCopy({ ...base, itemCount: 2, trimmed: "" })).toBeNull();
  });
});

describe("spotlightTarget", () => {
  test("skips query history rows", () => {
    expect(
      spotlightTarget({
        displayName: "rust",
        href: "",
        id: "q",
        type: "history",
      })
    ).toBeUndefined();
  });
});
