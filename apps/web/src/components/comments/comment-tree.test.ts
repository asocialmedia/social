import { describe, expect, test } from "bun:test";

import type { CommentData } from "@asm/db";

import {
  buildCommentTree,
  MAX_COMMENT_DEPTH,
  mergeCommentsWithLive,
} from "./comment-tree";

function makeComment(
  id: string,
  createdAt: Date,
  parentId?: string | null
): CommentData {
  return {
    _count: { votes: 0 },
    attachments: [],
    aura: 0,
    content: `content-${id}`,
    createdAt,
    deleted: false,
    id,
    parentId: parentId ?? null,
    postId: "post-1",
    rootId: parentId ? "top-1" : null,
    user: {
      aura: 0,
      avatarKey: null,
      avatarUrl: null,
      bannerKey: null,
      bannerUrl: null,
      bio: null,
      createdAt: new Date(),
      displayName: `User ${id}`,
      email: null,
      emailVerified: false,
      followers: [],
      following: [],
      githubUsername: null,
      googleId: null,
      id: `user-${id}`,
      linkedinUsername: null,
      passwordHash: null,
      redditId: null,
      redditUsername: null,
      twitterUsername: null,
      username: `user-${id}`,
    },
    userId: `user-${id}`,
    votes: [],
  } satisfies CommentData;
}

const now = Date.now();
const t = (msAgo: number) => new Date(now - msAgo);

describe("buildCommentTree", () => {
  test("orders top-level comments newest first", () => {
    const old = makeComment("a", t(10_000));
    const fresh = makeComment("b", t(100));
    const tree = buildCommentTree([old, fresh]);

    expect(tree.map((node) => node.comment.id)).toEqual(["b", "a"]);
  });

  test("nests replies under their parent oldest first", () => {
    const top = makeComment("top-1", t(5000));
    const reply1 = makeComment("r1", t(4000), "top-1");
    const reply2 = makeComment("r2", t(1000), "top-1");

    const tree = buildCommentTree([top, reply1, reply2]);

    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((n) => n.comment.id)).toEqual(["r1", "r2"]);
  });

  test("supports reply-to-reply nesting", () => {
    const top = makeComment("top-1", t(5000));
    const reply = makeComment("r1", t(4000), "top-1");
    const nested = makeComment("r1a", t(3000), "r1");
    const deep = makeComment("r1a1", t(2000), "r1a");

    const tree = buildCommentTree([top, reply, nested, deep]);

    expect(tree[0].comment.id).toBe("top-1");
    expect(tree[0].children[0].comment.id).toBe("r1");
    expect(tree[0].children[0].children[0].comment.id).toBe("r1a");
    expect(tree[0].children[0].children[0].children[0].comment.id).toBe("r1a1");
  });

  test("tracks depth on every node", () => {
    const top = makeComment("top-1", t(5000));
    const reply = makeComment("r1", t(4000), "top-1");
    const nested = makeComment("r1a", t(3000), "r1");

    const tree = buildCommentTree([top, reply, nested]);

    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  test("holds orphaned replies (parent not loaded) as roots until it arrives", () => {
    const top = makeComment("top-1", t(5000));
    const orphan = makeComment("r1", t(6000), "missing-parent");

    const tree = buildCommentTree([top, orphan]);

    // Orphan sorts as a top-level root because its parent is not loaded.
    expect(tree.map((n) => n.comment.id)).toEqual(["top-1", "r1"]);

    // Once the parent arrives the orphan re-nests under it.
    const merged = buildCommentTree([
      top,
      orphan,
      makeComment("missing-parent", t(5500)),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].comment.id).toBe("top-1");
    expect(merged[1].comment.id).toBe("missing-parent");
    expect(merged[1].children.map((n) => n.comment.id)).toEqual(["r1"]);
  });

  test("clamps nothing internally but exposes a max depth constant", () => {
    expect(MAX_COMMENT_DEPTH).toBeGreaterThanOrEqual(4);
  });
});

describe("mergeCommentsWithLive", () => {
  test("adds live comments that are not in the server payload", () => {
    const server = [makeComment("a", t(1000))];
    const live = new Map<string, CommentData>([
      ["live-1", makeComment("live-1", t(100))],
    ]);

    const merged = mergeCommentsWithLive(server, live);

    expect(merged.map((c) => c.id).toSorted()).toEqual(["a", "live-1"]);
  });

  test("server wins over a live entry for the same id", () => {
    const server = [makeComment("a", t(1000))];
    const live = new Map<string, CommentData>([
      // stale copy
      ["a", makeComment("a", t(1000))],
    ]);

    const merged = mergeCommentsWithLive(server, live);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("a");
  });

  test("a live soft-delete is applied on top of the server copy", () => {
    const server = [makeComment("a", t(1000))];
    const live = new Map<string, CommentData>([
      [
        "a",
        {
          ...makeComment("a", t(1000)),
          content: "",
          deleted: true,
        },
      ],
    ]);

    const merged = mergeCommentsWithLive(server, live);

    expect(merged[0].deleted).toBe(true);
    expect(merged[0].content).toBe("");
  });
});
