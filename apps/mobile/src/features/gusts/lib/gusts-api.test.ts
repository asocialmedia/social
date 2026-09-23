import { describe, expect, mock, test } from "bun:test";

import type { FeedPost } from "@/features/feed/lib/feed-types";

import {
  buildGustsPath,
  defaultGustTab,
  fetchGustsPage,
  gustShareUrl,
  isPlayableGust,
  mergeGustPages,
  parseGustTab,
  setFollowing,
  setNotInterested,
  submitRecommendationEvents,
} from "./gusts-api";

function gust(id: string, extra: Partial<FeedPost> = {}): FeedPost {
  return {
    attachments: [{ id: `m-${id}`, type: "VIDEO" }],
    createdAt: "2026-09-01T00:00:00.000Z",
    id,
    isGust: true,
    userId: "u1",
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("tabs", () => {
  test("defaults to For you when signed in and Latest for guests", () => {
    expect(defaultGustTab(true)).toBe("personalized");
    expect(defaultGustTab(false)).toBe("latest");
  });

  test("parses only known tabs", () => {
    expect(parseGustTab("latest")).toBe("latest");
    expect(parseGustTab("personalized")).toBe("personalized");
    expect(parseGustTab("trending")).toBeNull();
    expect(parseGustTab()).toBeNull();
  });
});

describe("buildGustsPath", () => {
  test("always excludes moderated gusts", () => {
    expect(buildGustsPath({ personalized: false })).toBe(
      "/api/gusts?excludeModerated=1"
    );
  });

  test("asks for personalized pages only without a deep link", () => {
    expect(buildGustsPath({ personalized: true })).toBe(
      "/api/gusts?mode=personalized&excludeModerated=1"
    );
    expect(buildGustsPath({ initialId: "abc", personalized: true })).toBe(
      "/api/gusts?initialId=abc&excludeModerated=1"
    );
  });

  test("a cursor wins over the deep link and is encoded", () => {
    expect(
      buildGustsPath({
        cursor: "fyp.gust.10.1700",
        initialId: "abc",
        personalized: false,
      })
    ).toBe("/api/gusts?cursor=fyp.gust.10.1700&excludeModerated=1");
    expect(buildGustsPath({ cursor: "a b", personalized: true })).toBe(
      "/api/gusts?cursor=a%20b&mode=personalized&excludeModerated=1"
    );
  });

  test("caps take at the route's 20", () => {
    expect(buildGustsPath({ personalized: false, take: 50 })).toBe(
      "/api/gusts?excludeModerated=1&take=20"
    );
  });
});

describe("mergeGustPages", () => {
  test("dedupes a deep-linked gust that reappears in a later page", () => {
    const merged = mergeGustPages([
      { nextCursor: "c1", posts: [gust("lead"), gust("a")] },
      { nextCursor: null, posts: [gust("b"), gust("lead")] },
    ]);
    expect(merged.map((post) => post.id)).toEqual(["lead", "a", "b"]);
  });

  test("drops moderated, hidden and video-less posts", () => {
    const merged = mergeGustPages(
      [
        {
          nextCursor: null,
          posts: [
            gust("ok"),
            gust("mod", { moderated: true }),
            gust("img", { attachments: [{ id: "i", type: "IMAGE" }] }),
            gust("hidden"),
          ],
        },
      ],
      new Set(["hidden"])
    );
    expect(merged.map((post) => post.id)).toEqual(["ok"]);
    expect(isPlayableGust(gust("x", { attachments: [] }))).toBe(false);
  });
});

describe("fetchGustsPage", () => {
  test("sends the session cookie and normalizes the page", async () => {
    const baseFetch = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({ nextCursor: "n1", posts: [gust("a"), { bad: true }] })
      )
    );
    const page = await fetchGustsPage(
      { personalized: false },
      {
        apiBase: "http://api",
        baseFetch: baseFetch as unknown as typeof fetch,
        cookie: "s=1",
      }
    );
    expect(page.nextCursor).toBe("n1");
    expect(page.posts.map((post) => post.id)).toEqual(["a"]);
    expect(page.posts[0]?.tags).toEqual([]);
    const [url, init] = baseFetch.mock.calls[0] ?? [];
    expect(url).toBe("http://api/api/gusts?excludeModerated=1");
    expect((init?.headers as Record<string, string> | undefined)?.cookie).toBe(
      "s=1"
    );
  });

  test("throws with the status on failure", async () => {
    const baseFetch = (() =>
      Promise.resolve(jsonResponse({}, 503))) as unknown as typeof fetch;
    await expect(
      fetchGustsPage({ personalized: false }, { apiBase: "", baseFetch })
    ).rejects.toThrow("Gusts request failed (503)");
  });
});

describe("mutations", () => {
  test("follow and unfollow hit the followers route", async () => {
    const calls: string[] = [];
    const baseFetch = ((url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      return Promise.resolve(
        jsonResponse({
          followers: 3,
          isFollowedByUser: init?.method === "POST",
        })
      );
    }) as unknown as typeof fetch;
    const followed = await setFollowing("u 2", true, {
      apiBase: "",
      baseFetch,
    });
    expect(followed).toEqual({ followers: 3, isFollowedByUser: true });
    await setFollowing("u2", false, { apiBase: "", baseFetch });
    expect(calls).toEqual([
      "POST /api/users/u%202/followers",
      "DELETE /api/users/u2/followers",
    ]);
  });

  test("not interested posts and undo deletes", async () => {
    const calls: string[] = [];
    const baseFetch = ((url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url} ${String(init?.body)}`);
      return Promise.resolve(jsonResponse({ ok: true }));
    }) as unknown as typeof fetch;
    await setNotInterested("p1", true, { apiBase: "", baseFetch });
    await setNotInterested("p1", false, { apiBase: "", baseFetch });
    expect(calls).toEqual([
      'POST /api/recommendations/not-interested {"postId":"p1"}',
      'DELETE /api/recommendations/not-interested {"postId":"p1"}',
    ]);
  });

  test("an empty event batch never hits the network", async () => {
    const baseFetch = mock(() => Promise.resolve(jsonResponse({})));
    await submitRecommendationEvents([], {
      apiBase: "",
      baseFetch: baseFetch as unknown as typeof fetch,
    });
    expect(baseFetch).not.toHaveBeenCalled();
  });
});

test("gust share links use the full id on /gusts", () => {
  expect(gustShareUrl("https://asocial.media/", "abc-123")).toBe(
    "https://asocial.media/gusts?id=abc-123"
  );
});
