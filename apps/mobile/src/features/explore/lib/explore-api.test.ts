import { describe, expect, test } from "bun:test";

import {
  blueskyAuthorToPeopleAccount,
  buildExploreGustsPath,
  buildExplorePostsPath,
  buildExploreSearchPath,
  buildExploreTopGustsPath,
  fetchExploreHeadPosts,
  fetchExplorePage,
  fetchExplorePeople,
  fetchExploreTopGusts,
  mutateExploreFollow,
  parseExplorePage,
  reasonIcon,
} from "./explore-api";

const API = "https://api.test";

const post = {
  attachments: [],
  content: "hello",
  createdAt: "2026-09-25T00:00:00.000Z",
  id: "post-1",
  userId: "user-1",
};

describe("explore paths", () => {
  test("encodes search, cursors, and feed filters", () => {
    expect(buildExploreSearchPath("two words", "trending")).toBe(
      "/api/explore/search?q=two%20words&tab=trending&take=20"
    );
    // Web's People search pages twelve at a time, not twenty.
    expect(buildExploreSearchPath("two words", "people", 12)).toBe(
      "/api/explore/search?q=two%20words&tab=people&take=12"
    );
    expect(buildExplorePostsPath("trending", "next cursor")).toBe(
      "/api/posts/trending?excludeModerated=1&take=20&cursor=next%20cursor"
    );
    expect(buildExploreGustsPath("c")).toBe(
      "/api/gusts?excludeModerated=1&mode=personalized&take=12&cursor=c"
    );
  });
});

describe("explore parsing", () => {
  test("normalizes posts, users, communities, and cursors", () => {
    const page = parseExplorePage(
      {
        communities: [{ id: "c1", name: "General", slug: "general" }],
        nextCursor: "next",
        posts: [post],
        users: [{ _count: { followers: 2 }, id: "u1", username: "alice" }],
      },
      "posts"
    );
    expect(page.posts[0]?.attachments).toEqual([]);
    expect(page.users[0]?.username).toBe("alice");
    expect(page.communities[0]?.slug).toBe("general");
    expect(page.nextCursor).toBe("next");
  });

  test("drops malformed rows without failing the page", () => {
    const page = parseExplorePage(
      { posts: [post, { id: 4 }], users: [{ username: "missing-id" }] },
      "gusts"
    );
    expect(page.posts).toHaveLength(1);
    expect(page.users).toHaveLength(0);
  });
});

describe("explore requests", () => {
  test("pagination fetches only posts, preserving already loaded recommendations", async () => {
    const requests: string[] = [];
    const page = await fetchExplorePage("trending", "", "next", {
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requests.push(String(input));
        return Promise.resolve(
          Response.json({ nextCursor: null, posts: [post] })
        );
      }) as typeof fetch,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("cursor=next");
    expect(page.users).toEqual([]);
  });
  test("loads a feed page with cookie forwarding", async () => {
    const requests: string[] = [];
    const page = await fetchExplorePage("trending", "", null, {
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requests.push(String(input));
        return Promise.resolve(
          Response.json({
            nextCursor: null,
            posts: [post],
            users: [{ id: "u1", username: "alice" }],
          })
        );
      }) as unknown as typeof fetch,
      cookie: "session=1",
    });
    expect(
      requests.some((request) => request.includes("/api/posts/trending"))
    ).toBe(true);
    // Web's first page is posts only; people come from suggestion cards.
    expect(requests).toHaveLength(1);
    expect(page.users).toEqual([]);
    expect(page.posts[0]?.id).toBe("post-1");
  });

  test("probes head posts without touching people endpoints", async () => {
    const requests: string[] = [];
    const posts = await fetchExploreHeadPosts("for-you", {
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({ posts: [post] }));
      }) as unknown as typeof fetch,
      cookie: "session=1",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(
      "/api/posts/for-you?excludeModerated=1&take=20"
    );
    expect(posts[0]?.id).toBe("post-1");
  });

  test("top gusts match web's trending rail params", async () => {
    let requested = "";
    const posts = await fetchExploreTopGusts({
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requested = String(input);
        return Promise.resolve(Response.json({ posts: [post] }));
      }) as unknown as typeof fetch,
      network: {
        locale: "en",
        profile: "profile-1",
        scope: "scope-1",
        surface: "explore",
      },
    });
    const url = new URL(requested);
    expect(url.pathname).toBe("/api/gusts");
    expect(url.searchParams.get("excludeModerated")).toBe("1");
    expect(url.searchParams.get("mode")).toBe("trending");
    expect(url.searchParams.get("take")).toBe("24");
    expect(url.searchParams.get("profile")).toBe("profile-1");
    expect(url.searchParams.has("network")).toBe(true);
    expect(url.searchParams.has("surface")).toBe(false);
    expect(posts[0]?.id).toBe("post-1");
  });

  test("top gusts keep network=1 without a network context", async () => {
    let requested = "";
    await fetchExploreTopGusts({
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requested = String(input);
        return Promise.resolve(Response.json({ posts: [] }));
      }) as unknown as typeof fetch,
    });
    expect(requested).toBe(`${API}${buildExploreTopGustsPath()}`);
    expect(new URL(requested).searchParams.get("network")).toBe("1");
  });

  test("people discovery fetches nothing: web renders suggestion accounts", async () => {
    // Web's People discovery reads /api/recommendations/suggestions (via
    // useDiscoverySuggestions), never the users endpoints, so an empty query
    // must not hit the network at all.
    let requested = "";
    const page = await fetchExplorePeople("", {
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requested = String(input);
        return Promise.resolve(Response.json({ users: [] }));
      }) as unknown as typeof fetch,
    });
    expect(requested).toBe("");
    expect(page).toEqual({
      communities: [],
      nextCursor: null,
      posts: [],
      users: [],
    });
  });

  test("people search pages twelve users like web", async () => {
    let requested = "";
    const page = await fetchExplorePeople("ali", {
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requested = String(input);
        return Promise.resolve(
          Response.json({ users: [{ id: "u1", username: "alice" }] })
        );
      }) as unknown as typeof fetch,
    });
    expect(requested).toBe(
      `${API}/api/explore/search?q=ali&tab=people&take=12`
    );
    expect(page.users[0]?.username).toBe("alice");
    expect(page.nextCursor).toBeNull();
  });

  test("bluesky authors map to search-match suggestion accounts", () => {
    expect(
      blueskyAuthorToPeopleAccount({
        avatarUrl: "https://cdn.example/a.png",
        bannerUrl: undefined,
        description: "writes about art",
        displayName: "",
        handle: "alice.test",
        id: "did:plc:alice",
        labels: [],
        source: "bluesky",
        upstreamCounts: { followers: 41 },
        url: "https://bsky.app/profile/alice.test",
      })
    ).toEqual({
      avatarUrl: "https://cdn.example/a.png",
      bannerUrl: null,
      displayName: "alice.test",
      followers: 41,
      following: false,
      handle: "alice.test",
      href: "/network/bluesky/profile?actor=did%3Aplc%3Aalice",
      id: "did:plc:alice",
      reason: "Search match",
      source: "bluesky",
    });
  });

  test("surfaces follow failures for the install-token gate", async () => {
    await expect(
      mutateExploreFollow("user-1", true, {
        apiBase: API,
        baseFetch: (() =>
          Promise.resolve(
            Response.json({}, { status: 403 })
          )) as unknown as typeof fetch,
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("explore user reasons", () => {
  test("parses mutual followers and drops malformed entries", () => {
    const page = parseExplorePage(
      {
        users: [
          {
            id: "u1",
            mutualFollowers: [
              { avatarUrl: "/a.png", displayName: "Bo", username: "bo" },
              { displayName: "missing username" },
            ],
            username: "alice",
          },
        ],
      },
      "posts"
    );
    expect(page.users[0]?.mutualFollowers).toEqual([
      { avatarUrl: "/a.png", displayName: "Bo", username: "bo" },
    ]);
  });

  test("picks web's reason glyph by keyword", () => {
    expect(reasonIcon("Active this week")).toBe("active");
    expect(reasonIcon("Popular on asocialmedia")).toBe("popular");
    expect(reasonIcon("Shares your interests")).toBe("interest");
    expect(reasonIcon("Suggested for you")).toBeNull();
  });
});
