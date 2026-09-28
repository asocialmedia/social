import { describe, expect, test } from "bun:test";

import {
  buildHashtagPath,
  canonicalTag,
  parseHashtagPage,
} from "./hashtag-api";

describe("canonicalTag", () => {
  test("strips a leading hash and lowercases, matching the stored tag", () => {
    expect(canonicalTag("#Rust")).toBe("rust");
    expect(canonicalTag("RUST")).toBe("rust");
    expect(canonicalTag("rust")).toBe("rust");
  });

  test("decodes a percent-encoded tag from a deep link", () => {
    expect(canonicalTag("C%2B%2B")).toBe("c++");
    // Decoding happens before the hash is stripped, so an encoded hash resolves
    // to the same tag a tapped chip produces.
    expect(canonicalTag("%23rust")).toBe("rust");
  });

  test("survives a malformed escape rather than throwing on a link", () => {
    // decodeURIComponent rejects the truncated sequence, so the raw text is
    // used and only lowercased.
    expect(canonicalTag("%E0%A4%A")).toBe("%e0%a4%a");
  });

  test("trims surrounding whitespace", () => {
    expect(canonicalTag("  #Rust  ")).toBe("rust");
  });

  test("reduces an empty or hash-only tag to an empty string", () => {
    expect(canonicalTag("")).toBe("");
    expect(canonicalTag("#")).toBe("");
    expect(canonicalTag("   ")).toBe("");
  });
});

describe("buildHashtagPath", () => {
  test("sends the tag as the search query", () => {
    expect(buildHashtagPath("rust", null)).toBe("/api/search?q=rust");
  });

  test("adds the cursor only when there is one", () => {
    expect(buildHashtagPath("rust", "post-1")).toBe(
      "/api/search?q=rust&cursor=post-1"
    );
  });

  test("encodes a tag that needs it", () => {
    expect(buildHashtagPath("c++", null)).toBe("/api/search?q=c%2B%2B");
  });
});

describe("parseHashtagPage", () => {
  test("reads the posts and the cursor", () => {
    const page = parseHashtagPage({
      nextCursor: "post-2",
      posts: [{ id: "post-1" }],
    });
    expect(page.nextCursor).toBe("post-2");
    expect(page.posts).toHaveLength(1);
  });

  test("returns an empty list for a missing or malformed payload", () => {
    expect(parseHashtagPage(null)).toEqual({ nextCursor: null, posts: [] });
    expect(parseHashtagPage({})).toEqual({ nextCursor: null, posts: [] });
    expect(parseHashtagPage({ posts: "nope" })).toEqual({
      nextCursor: null,
      posts: [],
    });
  });

  test("drops rows with no usable id", () => {
    const page = parseHashtagPage({
      posts: [{ id: "post-1" }, { nope: true }, null, "post-2"],
    });
    expect(page.posts).toHaveLength(1);
  });

  test("treats an empty cursor string as no cursor", () => {
    expect(
      parseHashtagPage({ nextCursor: "", posts: [] }).nextCursor
    ).toBeNull();
  });
});
