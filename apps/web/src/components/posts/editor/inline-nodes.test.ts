import { describe, expect, test } from "bun:test";

import { collectInlineRelations, mergeUniqueIds } from "./inline-nodes";

describe("collectInlineRelations", () => {
  test("returns empty relations for an empty doc", () => {
    expect(
      collectInlineRelations({
        content: [{ content: [], type: "paragraph" }],
        type: "doc",
      })
    ).toEqual({ mentionIds: [], tags: [] });
  });

  test("collects mention ids and lowercased tags from pills", () => {
    const doc = {
      content: [
        {
          content: [
            { text: "hey ", type: "text" },
            {
              attrs: {
                avatarUrl: "https://cdn.test/a.png",
                displayName: "Ada",
                id: "user-1",
                username: "ada",
              },
              type: "mention",
            },
            { text: " check ", type: "text" },
            { attrs: { tag: "Design" }, type: "hashtag" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    };
    expect(collectInlineRelations(doc)).toEqual({
      mentionIds: ["user-1"],
      tags: ["design"],
    });
  });

  test("dedupes repeated pills and skips pills without ids", () => {
    const doc = {
      content: [
        {
          content: [
            {
              attrs: { id: "user-1", username: "ada" },
              type: "mention",
            },
            {
              attrs: { id: "user-1", username: "ada" },
              type: "mention",
            },
            { attrs: { id: "", username: "ghost" }, type: "mention" },
            { attrs: { tag: "Design" }, type: "hashtag" },
            { attrs: { tag: "design" }, type: "hashtag" },
            { attrs: {}, type: "hashtag" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    };
    expect(collectInlineRelations(doc)).toEqual({
      mentionIds: ["user-1"],
      tags: ["design"],
    });
  });

  test("ignores plain @text without a pill and survives junk input", () => {
    const doc = {
      content: [
        {
          content: [{ text: "@ada #design", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    };
    expect(collectInlineRelations(doc)).toEqual({
      mentionIds: [],
      tags: [],
    });
    expect(collectInlineRelations(null)).toEqual({
      mentionIds: [],
      tags: [],
    });
    expect(collectInlineRelations("nope")).toEqual({
      mentionIds: [],
      tags: [],
    });
  });
});

describe("mergeUniqueIds", () => {
  test("merges explicit and inline ids without duplicates", () => {
    expect(mergeUniqueIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("drops empty entries", () => {
    expect(mergeUniqueIds(["", "a"], ["", "a"])).toEqual(["a"]);
  });
});
