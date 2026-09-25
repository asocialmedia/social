import { describe, expect, test } from "bun:test";

import {
  buildCommunitiesPath,
  fetchCommunitiesPage,
  parseCommunityPage,
} from "./communities-api";

const API = "https://api.test";

const community = {
  _count: { members: 4, posts: 8 },
  accentColor: "orange",
  avatarUrl: "/avatars/general.png",
  bannerUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  description: "A place to talk",
  id: "community-1",
  mature: false,
  name: "General",
  ownerId: "user-1",
  slug: "general",
  topics: ["chat"],
  type: "PUBLIC",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("community paths and parsing", () => {
  test("encodes category, search, cursor, and joined filters", () => {
    expect(
      buildCommunitiesPath({
        category: "science_tech",
        cursor: "next cursor",
        joined: true,
        query: "two words",
      })
    ).toBe(
      "/api/communities?category=science_tech&limit=24&q=two+words&cursor=next+cursor&joined=1"
    );
  });

  test("normalizes community lists, rails, stats, and malformed rows", () => {
    const page = parseCommunityPage({
      auras: { bad: "no", "community-1": 12 },
      communities: [community, { id: "bad" }],
      counts: { all: 3 },
      joined: [community],
      nextCursor: "next",
      sections: { growing: [community], trending: [] },
      stats: { communities: 3, members: 9, posts: 14 },
      total: 3,
    });
    expect(page.communities).toHaveLength(1);
    expect(page.joined[0]?.slug).toBe("general");
    expect(page.sections.growing).toHaveLength(1);
    expect(page.auras).toEqual({ "community-1": 12 });
    expect(page.stats.posts).toBe(14);
    expect(page.nextCursor).toBe("next");
  });

  test("fetches a community page with the session cookie", async () => {
    let requested = "";
    const page = await fetchCommunitiesPage(
      { category: "all", cursor: null, query: "" },
      {
        apiBase: API,
        baseFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
          requested = String(input);
          expect(init?.headers).toEqual({ cookie: "session=1" });
          return Promise.resolve(
            Response.json({ communities: [community], total: 1 })
          );
        }) as unknown as typeof fetch,
        cookie: "session=1",
      }
    );
    expect(requested).toBe(`${API}/api/communities?category=all&limit=24`);
    expect(page.communities[0]?.name).toBe("General");
  });
});
