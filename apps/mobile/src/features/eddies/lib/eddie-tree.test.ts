import { describe, expect, test } from "bun:test";

import type { FeedComment } from "@/features/feed/lib/feed-api";

import {
  buildEddieTree,
  countVisible,
  mergeEddies,
  withCreatedEddie,
  withDeletedEddie,
} from "./eddie-tree";

function eddie(
  id: string,
  createdAt: string,
  extra: Partial<FeedComment> = {}
): FeedComment {
  return { content: id, createdAt, id, ...extra };
}

describe("buildEddieTree", () => {
  test("nests replies under their parents with depth", () => {
    const tree = buildEddieTree([
      eddie("a", "2026-01-01T00:00:00Z"),
      eddie("a1", "2026-01-01T00:01:00Z", { parentId: "a" }),
      eddie("a1x", "2026-01-01T00:02:00Z", { parentId: "a1" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children[0]?.comment.id).toBe("a1");
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
  });

  test("orders top-level newest first and replies oldest first", () => {
    const tree = buildEddieTree([
      eddie("old", "2026-01-01T00:00:00Z"),
      eddie("new", "2026-01-02T00:00:00Z"),
      eddie("r2", "2026-01-01T00:05:00Z", { parentId: "old" }),
      eddie("r1", "2026-01-01T00:01:00Z", { parentId: "old" }),
    ]);
    expect(tree.map((node) => node.comment.id)).toEqual(["new", "old"]);
    expect(tree[1]?.children.map((node) => node.comment.id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  test("prunes a deleted leaf but keeps a deleted parent with replies", () => {
    const tree = buildEddieTree([
      eddie("gone", "2026-01-01T00:00:00Z", { deleted: true }),
      eddie("kept", "2026-01-02T00:00:00Z", { deleted: true }),
      eddie("child", "2026-01-02T00:01:00Z", { parentId: "kept" }),
    ]);
    expect(tree.map((node) => node.comment.id)).toEqual(["kept"]);
  });

  test("treats orphans whose parent is not loaded as roots", () => {
    const tree = buildEddieTree([
      eddie("orphan", "2026-01-01T00:00:00Z", { parentId: "missing" }),
    ]);
    expect(tree[0]?.depth).toBe(0);
  });
});

describe("local mutations", () => {
  test("merges pages and new eddies without duplicates", () => {
    const merged = mergeEddies(
      [eddie("a", "2026-01-01T00:00:00Z")],
      [eddie("a", "2026-01-01T00:00:00Z"), eddie("b", "2026-01-01T00:01:00Z")]
    );
    expect(merged.map((comment) => comment.id)).toEqual(["a", "b"]);
    expect(
      withCreatedEddie(merged, eddie("c", "2026-01-01T00:02:00Z"))
    ).toHaveLength(3);
  });

  test("soft-deletes locally and the tree prunes the leaf", () => {
    const list = withDeletedEddie([eddie("a", "2026-01-01T00:00:00Z")], "a");
    expect(list[0]?.deleted).toBe(true);
    expect(list[0]?.content).toBe("");
    expect(countVisible(buildEddieTree(list))).toBe(0);
  });
});
