import { describe, expect, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import { removePostFromFeedCache, repairStalePostCaches } from "./cache-sync";

interface Page {
  nextCursor: string | null;
  posts: { id: string }[];
}
interface FeedData {
  pageParams: unknown[];
  pages: Page[];
}

function makeClient(queryKey: unknown[], pages: Page[]): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData<FeedData>(queryKey, {
    pageParams: [null, "c1"],
    pages,
  });
  return queryClient;
}

const pagesWithDeleted: Page[] = [
  { nextCursor: "c1", posts: [{ id: "p-new" }, { id: "p-deleted" }] },
  { nextCursor: null, posts: [{ id: "p-other" }] },
];

describe("removePostFromFeedCache", () => {
  test("removes the post and preserves cursors and later pages", () => {
    const queryClient = makeClient(["post-feed", "for-you"], pagesWithDeleted);

    const removed = removePostFromFeedCache(
      queryClient,
      ["post-feed", "for-you"],
      "p-deleted"
    );

    expect(removed).toBe(true);
    const data = queryClient.getQueryData<FeedData>(["post-feed", "for-you"]);
    expect(data?.pages[0]?.posts.map((p) => p.id)).toEqual(["p-new"]);
    expect(data?.pages[1]?.posts.map((p) => p.id)).toEqual(["p-other"]);
    expect(data?.pages[0]?.nextCursor).toBe("c1");
    expect(data?.pageParams).toEqual([null, "c1"]);
  });

  test("prefix key clears the post from every matching feed", () => {
    // This is the community-delete regression: the community feed keys are
    // ["community-feed", slug, sort], and the delete flow had to reach them all.
    const queryClient = new QueryClient();
    for (const key of [
      ["community-feed", "anime", "new"],
      ["community-feed", "anime", "top"],
      ["community-feed", "cosplay", "new"],
    ]) {
      queryClient.setQueryData<FeedData>(key, {
        pageParams: [null],
        pages: [
          {
            nextCursor: null,
            posts: [{ id: "p-deleted" }, { id: "p-keep" }],
          },
        ],
      });
    }

    const removed = removePostFromFeedCache(
      queryClient,
      ["community-feed"],
      "p-deleted"
    );

    expect(removed).toBe(true);
    for (const key of [
      ["community-feed", "anime", "new"],
      ["community-feed", "anime", "top"],
      ["community-feed", "cosplay", "new"],
    ]) {
      const data = queryClient.getQueryData<FeedData>(key);
      expect(data?.pages[0]?.posts.map((p) => p.id)).toEqual(["p-keep"]);
    }
  });

  test("reports false and leaves data untouched when the post is absent", () => {
    const queryClient = makeClient(
      ["community-feed", "anime", "new"],
      [{ nextCursor: null, posts: [{ id: "p-keep" }] }]
    );
    const before = queryClient.getQueryData(["community-feed", "anime", "new"]);

    const removed = removePostFromFeedCache(
      queryClient,
      ["community-feed"],
      "p-missing"
    );

    expect(removed).toBe(false);
    // No-op path must return the same reference so subscribers are not notified.
    expect(queryClient.getQueryData(["community-feed", "anime", "new"])).toBe(
      before
    );
  });

  test("is a no-op on a key with no cached data", () => {
    const queryClient = new QueryClient();
    expect(
      removePostFromFeedCache(queryClient, ["community-feed"], "p-1")
    ).toBe(false);
  });
});

// The canonical shape `mapPostData` produces, which is what every feed/grid
// response carries. `repairStalePostCaches` must treat this as NOT stale;
// otherwise it returns true on every run and the caller loops
// `router.refresh()` + feed invalidation forever (the get-session flood).
function serverPost(id: string): Record<string, unknown> {
  return {
    _count: { bookmarks: 0, comments: 0, responses: 0, vote: 0 },
    attachments: [],
    aura: 0,
    bookmarks: [],
    content: "hi",
    id,
    mentions: [],
    tags: [],
    userId: "u1",
    vote: [],
  };
}

describe("repairStalePostCaches convergence", () => {
  test("a canonical server post is not stale", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["post-feed", "latest"], {
      pages: [{ posts: [serverPost("p1")] }],
    });
    expect(repairStalePostCaches(queryClient)).toBe(false);
  });

  test("a genuinely stale post is repaired once, then converges", () => {
    const queryClient = new QueryClient();
    const broken = serverPost("p1");
    // Missing viewer joins and two count fields, as an old cache row could be.
    delete broken.bookmarks;
    delete broken.vote;
    broken._count = { comments: 0 };
    queryClient.setQueryData(["post-feed", "latest"], {
      pages: [{ posts: [broken] }],
    });
    expect(repairStalePostCaches(queryClient)).toBe(true);
    // The repaired row now carries the full canonical shape, so a second pass
    // is a no-op. This is the regression: a repair that could not converge
    // re-fired on every render.
    expect(repairStalePostCaches(queryClient)).toBe(false);
  });
});
