import { describe, expect, test } from "bun:test";

import type { PostData } from "@asm/db";

import { groupPostsIntoThreads } from "./feed-thread-group";

function makeFeedPost(
  id: string,
  createdAt: Date,
  parentPostId: string | null = null
): PostData {
  return {
    createdAt,
    id,
    parentPost: null,
    parentPostId,
    rootPostId: parentPostId,
    threadTopId: null,
  } as unknown as PostData;
}

const now = Date.now();
const t = (msAgo: number) => new Date(now - msAgo);

describe("groupPostsIntoThreads", () => {
  test("returns empty array when posts are empty", () => {
    expect(groupPostsIntoThreads([])).toEqual([]);
  });

  test("keeps standalone posts as single-post groups", () => {
    const p1 = makeFeedPost("p1", t(1000));
    const p2 = makeFeedPost("p2", t(2000));

    const groups = groupPostsIntoThreads([p1, p2]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.posts.map((p) => p.id)).toEqual(["p1"]);
    expect(groups[1]?.posts.map((p) => p.id)).toEqual(["p2"]);
  });

  test("merges connected posts into a single chronological thread chain", () => {
    // Post chain: root -> reply1 -> reply2 -> reply3
    const root = makeFeedPost("root", t(5000));
    const reply1 = makeFeedPost("reply1", t(4000), "root");
    const reply2 = makeFeedPost("reply2", t(3000), "reply1");
    const reply3 = makeFeedPost("reply3", t(2000), "reply2");

    // Feed could have them in newest-first order
    const feed = [reply3, reply2, reply1, root];
    const groups = groupPostsIntoThreads(feed);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.posts.map((p) => p.id)).toEqual([
      "root",
      "reply1",
      "reply2",
      "reply3",
    ]);
  });

  test("handles sub-threads where root is not in feed slice", () => {
    // reply1 is in feed, but root is not
    const reply1 = makeFeedPost("reply1", t(4000), "unseen-root");
    const reply2 = makeFeedPost("reply2", t(3000), "reply1");

    const groups = groupPostsIntoThreads([reply2, reply1]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.posts.map((p) => p.id)).toEqual(["reply1", "reply2"]);
  });

  test("separates sibling replies to the same parent into separate thread groups", () => {
    const root = makeFeedPost("root", t(6000));
    const branchA = makeFeedPost("branchA", t(5000), "root");
    const branchB = makeFeedPost("branchB", t(4000), "root");

    const groups = groupPostsIntoThreads([branchB, branchA, root]);
    expect(groups).toHaveLength(2);
    // First group contains root -> branchA (the earlier reply)
    expect(groups[0]?.posts.map((p) => p.id)).toEqual(["root", "branchA"]);
    // Second group contains branchB as a standalone reply group
    expect(groups[1]?.posts.map((p) => p.id)).toEqual(["branchB"]);
  });
});
