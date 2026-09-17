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
    // Root connects to branchB (the freshest reply) and bumps to index 0
    expect(groups[0]?.posts.map((p) => p.id)).toEqual(["root", "branchB"]);
    // branchA remains as its own standalone reply group
    expect(groups[1]?.posts.map((p) => p.id)).toEqual(["branchA"]);
  });

  test("bumps thread group to the feed position of its newest reply (Twitter-style)", () => {
    const standaloneNew = makeFeedPost("standaloneNew", t(1000));
    const newReply = makeFeedPost("newReply", t(2000), "oldRoot");
    const standaloneMid = makeFeedPost("standaloneMid", t(3000));
    const oldRoot = makeFeedPost("oldRoot", t(4000));
    const standaloneOld = makeFeedPost("standaloneOld", t(5000));

    const feed = [
      standaloneNew,
      newReply,
      standaloneMid,
      oldRoot,
      standaloneOld,
    ];
    const groups = groupPostsIntoThreads(feed);

    expect(groups).toHaveLength(4);
    // Standalone post at index 0 stays on top
    expect(groups[0]?.posts.map((p) => p.id)).toEqual(["standaloneNew"]);
    // Thread [oldRoot, newReply] is bumped to position of newReply (index 1)
    expect(groups[1]?.posts.map((p) => p.id)).toEqual(["oldRoot", "newReply"]);
    expect(groups[2]?.posts.map((p) => p.id)).toEqual(["standaloneMid"]);
    expect(groups[3]?.posts.map((p) => p.id)).toEqual(["standaloneOld"]);
  });

  test("bumps thread to the very top when newest reply is at index 0", () => {
    const newReply = makeFeedPost("newReply", t(500), "oldRoot");
    const standalone = makeFeedPost("standalone", t(1000));
    const oldRoot = makeFeedPost("oldRoot", t(5000));

    const feed = [newReply, standalone, oldRoot];
    const groups = groupPostsIntoThreads(feed);

    expect(groups).toHaveLength(2);
    // Thread bumped to top because newReply is at index 0
    expect(groups[0]?.posts.map((p) => p.id)).toEqual(["oldRoot", "newReply"]);
    expect(groups[1]?.posts.map((p) => p.id)).toEqual(["standalone"]);
  });

  test("bumps multi-level thread based on latest grandchild response", () => {
    const grandchild = makeFeedPost("grandchild", t(500), "child");
    const standalone = makeFeedPost("standalone", t(1000));
    const child = makeFeedPost("child", t(2000), "root");
    const root = makeFeedPost("root", t(4000));

    const feed = [grandchild, standalone, child, root];
    const groups = groupPostsIntoThreads(feed);

    expect(groups).toHaveLength(2);
    // Entire chain connected top-to-bottom and bumped to index 0
    expect(groups[0]?.posts.map((p) => p.id)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
    expect(groups[1]?.posts.map((p) => p.id)).toEqual(["standalone"]);
  });
});
