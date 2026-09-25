import { describe, expect, test } from "bun:test";

import {
  buildExploreGustsPath,
  buildExplorePostsPath,
  buildExploreSearchPath,
  fetchExplorePage,
  fetchExplorePeople,
  mutateExploreFollow,
  parseExplorePage,
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
    expect(buildExplorePostsPath("trending", "next cursor")).toBe(
      "/api/posts/trending?excludeModerated=1&take=20&cursor=next%20cursor"
    );
    expect(buildExploreGustsPath("c")).toBe(
      "/api/gusts?excludeModerated=1&take=20&cursor=c"
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
    expect(
      requests.some((request) => request.includes("/api/users/trending"))
    ).toBe(true);
    expect(page.posts[0]?.id).toBe("post-1");
  });

  test("uses suggested people for signed-in viewers", async () => {
    let requested = "";
    const page = await fetchExplorePeople("", true, {
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requested = String(input);
        return Promise.resolve(
          Response.json([{ id: "u1", username: "alice" }])
        );
      }) as unknown as typeof fetch,
    });
    expect(requested).toBe(`${API}/api/users/suggested?limit=12`);
    expect(page.users[0]?.username).toBe("alice");
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
