import { describe, expect, test } from "bun:test";

import type { ExternalComment } from "@asm/protocols/discovery";

import {
  EXTERNAL_COMMENT_LIMIT,
  externalCommentsToFeed,
  mergeExternalComments,
} from "./external-comments";

function comment(id: string, content = id): ExternalComment {
  return {
    content,
    createdAt: "2026-10-01T00:00:00.000Z",
    deleted: false,
    id,
    source: "asm",
    user: {
      displayName: "Alice",
      id: "user-1",
      username: "alice",
    },
    userId: "user-1",
  };
}

describe("externalCommentsToFeed", () => {
  test("maps comments onto eddie rows with null defaults", () => {
    const [row] = externalCommentsToFeed([comment("c1")]);
    // EddieRow reads the untyped source field to label Bluesky comments.
    expect((row as { source?: string }).source).toBe("asm");
    expect(row).toMatchObject({
      content: "c1",
      createdAt: "2026-10-01T00:00:00.000Z",
      deleted: false,
      id: "c1",
      parentId: null,
      user: {
        avatarUrl: null,
        displayName: "Alice",
        id: "user-1",
        username: "alice",
      },
    });
  });
});

describe("mergeExternalComments", () => {
  test("appends a page and dedupes repeated ids in place", () => {
    const merged = mergeExternalComments(
      [comment("a"), comment("b")],
      [comment("b", "edited"), comment("c")]
    );
    expect(merged.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(merged[1]?.content).toBe("edited");
  });

  test("keeps only the newest comments past the cap", () => {
    const many = Array.from({ length: EXTERNAL_COMMENT_LIMIT + 5 }, (_, i) =>
      comment(`c${i}`)
    );
    const merged = mergeExternalComments([], many);
    expect(merged).toHaveLength(EXTERNAL_COMMENT_LIMIT);
    expect(merged[0]?.id).toBe("c5");
  });
});
