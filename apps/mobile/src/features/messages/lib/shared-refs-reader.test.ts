import { describe, expect, test } from "bun:test";

import {
  classifyRefs,
  mergeRefs,
  nextPagingCursor,
  SHARED_REFS_PAGE_SIZE,
} from "./shared-refs-reader";

function row(flatKey: string, createdAt: number) {
  return { createdAt, flatKey, messageId: `m-${flatKey}`, senderId: "u-1" };
}

describe("nextPagingCursor", () => {
  test("the first fill sets the cursor even though it prepends nothing", () => {
    expect(
      nextPagingCursor({
        after: "c1",
        currentAfter: undefined,
        currentDone: false,
        hasMore: true,
        mode: "refresh",
        started: false,
      })
    ).toEqual({ after: "c1", done: false });
  });

  test("a later refresh leaves the cursor and done flag alone", () => {
    expect(
      nextPagingCursor({
        after: "c9",
        currentAfter: "c1",
        currentDone: false,
        hasMore: false,
        mode: "refresh",
        started: true,
      })
    ).toEqual({ after: "c1", done: false });
  });

  test("more moves the cursor and can finish the kind", () => {
    expect(
      nextPagingCursor({
        after: "c2",
        currentAfter: "c1",
        currentDone: false,
        hasMore: false,
        mode: "more",
        started: true,
      })
    ).toEqual({ after: "c2", done: true });
  });
});

describe("mergeRefs", () => {
  test("an empty list takes the page as-is", () => {
    const page = [row("b", 2), row("a", 1)];
    expect(mergeRefs([], page, "refresh")).toEqual(page);
  });

  test("refresh merges by identity, newest first, without duplicates", () => {
    const current = [row("b", 2)];
    const page = [row("c", 3), row("b", 2)];
    expect(mergeRefs(current, page, "refresh").map((r) => r.flatKey)).toEqual([
      "c",
      "b",
    ]);
  });

  test("a page with nothing new keeps the same list", () => {
    const current = [row("b", 2)];
    expect(mergeRefs(current, [row("b", 2)], "more")).toBe(current);
  });
});

describe("classifyRefs", () => {
  test("in-app post links move to the posts tab and leave the links tab", () => {
    const links = [
      { ...row("l1", 3), url: "https://app.example/posts/p1" },
      { ...row("l2", 2), url: "https://other.example/x" },
    ];
    const { classifiedLinks, classifiedPosts } = classifyRefs(
      [{ ...row("p0", 1), postId: "p0" }],
      links,
      (url) => (url.includes("/posts/p1") ? "p1" : null)
    );
    expect(classifiedLinks.map((l) => l.flatKey)).toEqual(["l2"]);
    expect(classifiedPosts.map((p) => p.postId)).toEqual(["p1", "p0"]);
    // Newest first overall.
    expect(classifiedPosts[0].flatKey).toBe("l1");
  });

  test("the page size stays one cheap range read", () => {
    expect(SHARED_REFS_PAGE_SIZE).toBe(60);
  });
});
