import { describe, expect, test } from "bun:test";

import type { PostsPage } from "@asm/db";
import { QueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import { filterFeedPosts, prependPostsToFeedCache } from "./feed-cache";

type Post = PostsPage["posts"][number];
type FeedData = InfiniteData<PostsPage, string | null>;

const post = (id: string): Post => ({ id }) as unknown as Post;

function makeClient() {
  const queryClient = new QueryClient();
  const queryKey = ["post-feed", "for-you", "user1"];
  queryClient.setQueryData<FeedData>(queryKey, {
    pageParams: [null, "c1"],
    pages: [
      { nextCursor: "c1", posts: [post("b"), post("a")] },
      { nextCursor: null, posts: [post("z")] },
    ],
  });
  return { queryClient, queryKey };
}

function ids(data: FeedData | undefined, page: number): string[] | undefined {
  return data?.pages[page]?.posts.map((entry) => entry.id);
}

function listIds(list: { id: string }[]): string[] {
  return list.map((entry) => entry.id);
}

describe("filterFeedPosts", () => {
  const posts = [post("a"), post("b"), post("c")];

  test("keeps everything when no exclusions are supplied", () => {
    expect(listIds(filterFeedPosts(posts))).toEqual(["a", "b", "c"]);
  });

  test("drops the current detail post", () => {
    expect(listIds(filterFeedPosts(posts, { excludePostId: "b" }))).toEqual([
      "a",
      "c",
    ]);
  });

  test("drops ids already led by another segment", () => {
    expect(
      listIds(filterFeedPosts(posts, { excludeIds: new Set(["a", "c"]) }))
    ).toEqual(["b"]);
  });

  test("drops posts the viewer dismissed as not interested", () => {
    // The regression: a dismissed post came straight back from the server props
    // on the next reconciliation, so it must be filtered everywhere, not only
    // from the local list.
    expect(
      listIds(filterFeedPosts(posts, { dismissedIds: new Set(["a"]) }))
    ).toEqual(["b", "c"]);
  });

  test("applies every exclusion together", () => {
    const filtered = filterFeedPosts(posts, {
      dismissedIds: new Set(["a"]),
      excludeIds: new Set(["b"]),
      excludePostId: "c",
    });
    expect(listIds(filtered)).toEqual([]);
  });

  test("drops falsy entries without throwing", () => {
    const withHole = [post("a"), null, post("b")] as unknown as {
      id: string;
    }[];
    expect(listIds(filterFeedPosts(withHole))).toEqual(["a", "b"]);
  });
});

describe("prependPostsToFeedCache", () => {
  test("merges new posts into the head and keeps cursors and later pages", () => {
    const { queryClient, queryKey } = makeClient();

    const added = prependPostsToFeedCache(queryClient, queryKey, [
      post("n1"),
      post("b"),
    ]);

    expect(added).toBe(true);
    const data = queryClient.getQueryData<FeedData>(queryKey);
    expect(ids(data, 0)).toEqual(["n1", "b", "a"]);
    expect(ids(data, 1)).toEqual(["z"]);
    expect(data?.pages[0]?.nextCursor).toBe("c1");
    expect(data?.pageParams).toEqual([null, "c1"]);
  });

  test("no-ops when every incoming post is already cached", () => {
    const { queryClient, queryKey } = makeClient();

    const added = prependPostsToFeedCache(queryClient, queryKey, [post("a")]);

    expect(added).toBe(false);
    expect(ids(queryClient.getQueryData<FeedData>(queryKey), 0)).toEqual([
      "b",
      "a",
    ]);
  });

  test("returns false for an empty page or a missing cache entry", () => {
    const { queryClient, queryKey } = makeClient();

    expect(prependPostsToFeedCache(queryClient, queryKey, [])).toBe(false);
    expect(
      prependPostsToFeedCache(
        queryClient,
        ["post-feed", "missing"],
        [post("x")]
      )
    ).toBe(false);
  });
});
