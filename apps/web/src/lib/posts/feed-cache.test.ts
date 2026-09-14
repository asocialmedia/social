import { describe, expect, test } from "bun:test";

import type { PostsPage } from "@asm/db";
import { QueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import { prependPostsToFeedCache } from "./feed-cache";

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
