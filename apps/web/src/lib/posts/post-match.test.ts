import { describe, expect, test } from "bun:test";

import { selectPostMatch } from "./post-match";

// The real-world case: post ids are cuid (time-sortable), so two posts created
// in the same millisecond share the same 8-char short-id prefix. These two ids
// are a genuine same-millisecond pair from the dev database.
const PREFIX_COLLISION = [
  {
    content: "public community post",
    id: "cmu75ndfy0009r7vn4abyxptp",
  },
  {
    content: "private community post",
    id: "cmu75ndfy0008r7vn83a598p5",
  },
];

describe("selectPostMatch", () => {
  test("returns the only match", () => {
    const [only] = PREFIX_COLLISION;
    if (!only) {
      throw new Error("fixture missing");
    }
    expect(selectPostMatch([only])).toBe(only);
  });

  test("returns null for no matches", () => {
    expect(selectPostMatch([])).toBeNull();
  });

  test("disambiguates a same-millisecond prefix collision by content slug", () => {
    // Before the fix this returned null (prefix not unique), so the post 404ed.
    expect(
      selectPostMatch(PREFIX_COLLISION, { slug: "public-community-post" })?.id
    ).toBe("cmu75ndfy0009r7vn4abyxptp");
    expect(
      selectPostMatch(PREFIX_COLLISION, { slug: "private-community-post" })?.id
    ).toBe("cmu75ndfy0008r7vn83a598p5");
  });

  test("returns null when the slug matches neither candidate", () => {
    expect(
      selectPostMatch(PREFIX_COLLISION, { slug: "some-other-slug" })
    ).toBeNull();
  });

  test("disambiguates by media id when the request names a media row", () => {
    const withMedia = [
      {
        attachments: [{ id: "media-a" }],
        content: "post with media a",
        id: "cmu75ndfy0009r7vn4abyxptp",
      },
      {
        attachments: [{ id: "media-b" }],
        content: "post with media b",
        id: "cmu75ndfy0008r7vn83a598p5",
      },
    ];
    expect(selectPostMatch(withMedia, { mediaId: "media-b" })?.id).toBe(
      "cmu75ndfy0008r7vn83a598p5"
    );
  });

  test("stays ambiguous (null) with no discriminator", () => {
    // A bare short URL with no slug and no media cannot name one of several
    // colliding posts, so it must 404 rather than serve an arbitrary one.
    expect(selectPostMatch(PREFIX_COLLISION)).toBeNull();
  });

  test("resolves a three-way collision once the slug narrows it to one", () => {
    const threeWay = [
      ...PREFIX_COLLISION,
      { content: "a third post", id: "cmu75ndfy000ar7vnzd3n7f2c" },
    ];
    expect(selectPostMatch(threeWay, { slug: "a-third-post" })?.id).toBe(
      "cmu75ndfy000ar7vnzd3n7f2c"
    );
  });

  test("tolerates candidates without attachments when filtering by media", () => {
    const noAttachments = [
      { content: "no media here", id: "cmu75ndfy0009r7vn4abyxptp" },
      {
        attachments: [{ id: "media-b" }],
        content: "has media",
        id: "cmu75ndfy0008r7vn83a598p5",
      },
    ];
    expect(selectPostMatch(noAttachments, { mediaId: "media-b" })?.id).toBe(
      "cmu75ndfy0008r7vn83a598p5"
    );
  });
});
