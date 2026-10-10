import { describe, expect, test } from "bun:test";

import { flattenFeedRows, incomingFeedRows } from "./feed-rows";
import type { FeedPost } from "./feed-types";

function post(id: string): FeedPost {
  return {
    _count: { bookmarks: 0, comments: 0, responses: 0, vote: 0 },
    attachments: [],
    bookmarks: [],
    createdAt: "2026-10-08T00:00:00Z",
    id,
    mentions: [],
    tags: [],
    userId: "reader",
    vote: [],
  };
}

describe("post virtualization within feed threads", () => {
  test("incoming replies prepend without reordering retained posts or inventing rails", () => {
    const first = post("first");
    const parent = post("parent");
    const child = { ...post("child"), parentPostId: parent.id };
    const old = [first, parent, child];
    const before = incomingFeedRows(old, new Set());
    const freshReply = { ...post("fresh"), parentPostId: parent.id };
    const after = incomingFeedRows(
      [freshReply, ...old],
      new Set([freshReply.id])
    );
    expect(after.map((row) => row.post.id)).toEqual([
      "fresh",
      ...before.map((row) => row.post.id),
    ]);
    expect(after[0]?.hasThreadParent).toBe(false);
    expect(after.slice(1)).toEqual(before);
  });
  test("multiple batches retain old row identities and let new threads keep their rails", () => {
    const old = post("old");
    const parent = post("new-parent");
    const child = { ...post("new-child"), parentPostId: parent.id };
    const newest = post("newest");
    const rows = incomingFeedRows(
      [newest, child, parent, old],
      new Set([parent.id, child.id, newest.id])
    );
    expect(rows.map((row) => row.post.id)).toEqual([
      "newest",
      "new-parent",
      "new-child",
      "old",
    ]);
    expect(rows[1]?.hasThreadChild).toBe(true);
    expect(rows[2]?.hasThreadParent).toBe(true);
    expect(rows[3]?.post).toBe(old);
  });
  test("retains every post, original identity, order and thread boundaries", () => {
    const parent = post("parent");
    const child = post("child");
    const standalone = post("standalone");
    expect(
      flattenFeedRows([
        { id: "thread", posts: [parent, child] },
        { id: "single", posts: [standalone] },
      ])
    ).toEqual([
      { hasThreadChild: true, hasThreadParent: false, post: parent },
      { hasThreadChild: false, hasThreadParent: true, post: child },
      { hasThreadChild: false, hasThreadParent: false, post: standalone },
    ]);
  });

  test("a huge thread consists of individual cells and media visibility targets", () => {
    const posts = Array.from({ length: 500 }, (_, index) =>
      post(String(index))
    );
    const rows = flattenFeedRows([{ id: "large", posts }]);
    expect(rows.length).toBe(500);
    expect(rows.map((row) => row.post.id)).toEqual(
      posts.map((item) => item.id)
    );
    expect(rows.slice(0, 4).map((row) => row.post.id)).toEqual([
      "0",
      "1",
      "2",
      "3",
    ]);
    expect(rows[249]?.post).toBe(posts[249]);
    expect(rows[249]?.hasThreadParent).toBe(true);
    expect(rows[249]?.hasThreadChild).toBe(true);
    expect(rows[499]?.hasThreadChild).toBe(false);
    expect(flattenFeedRows([])).toEqual([]);
  });
});
