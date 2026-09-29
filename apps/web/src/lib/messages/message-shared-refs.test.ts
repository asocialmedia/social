import { describe, expect, test } from "bun:test";

import type { MessagePayload } from "@/lib/messages/crypto";

import { extractSharedRefs, sharedRefsEqual } from "./message-shared-refs";

// The single extractor behind the details panel's three tabs AND the rows the
// local index persists. Every assertion here is about the CONTRACT those two
// share, because the failure mode being guarded is the two disagreeing: a tab that
// lists what the thread does not render, or an index that re-derives different
// rows on the next visit.

function text(content: string): MessagePayload {
  return { content, type: "text" };
}

describe("extractSharedRefs", () => {
  test("a post share yields its post id and any link in the caption", () => {
    const refs = extractSharedRefs({
      content: "look http://localhost:3000/posts/p1 and https://example.com/x",
      postId: "p1",
      type: "post",
    });
    expect(refs).not.toBeNull();
    expect(refs?.postIds).toEqual(["p1"]);
    expect(refs?.media).toEqual([]);
  });

  // The in-app/external split is deliberately NOT made here. It needs the site
  // origin, which differs between a dev origin and production, and baking it
  // into a stored row would make rows written on one origin wrong on another.
  // The extractor keeps URLs, and the reader classifies.
  test("a link to an in-app post is left as a link for the reader to classify", () => {
    const refs = extractSharedRefs(text("http://localhost:3000/posts/p1"));
    // Sanitized, which also upgrades http to https for the display href. That is
    // the SAME string the bubble unfurls, which is the point: the panel's preview
    // and the transcript's card are one link, not two that merely look alike.
    expect(refs?.links).toEqual(["https://localhost:3000/posts/p1"]);
    expect(refs?.postIds).toEqual([]);
  });

  test("a media album yields one ref per image, indexed by album position", () => {
    const refs = extractSharedRefs({
      images: [
        { height: 1, url: "/api/media/a", width: 2 },
        { height: 3, url: "/api/media/b", width: 4 },
      ],
      kind: "image",
      type: "media",
    });
    expect(refs?.media).toEqual([
      {
        height: 1,
        imageIndex: 0,
        kind: "image",
        url: "/api/media/a",
        width: 2,
      },
      {
        height: 3,
        imageIndex: 1,
        kind: "image",
        url: "/api/media/b",
        width: 4,
      },
    ]);
  });

  test("a gif keeps its kind, which is what the tile badge renders", () => {
    const refs = extractSharedRefs({
      images: [{ url: "/api/media/g" }],
      kind: "gif",
      type: "media",
    });
    expect(refs?.media[0]?.kind).toBe("gif");
  });

  // The legacy single-image form, which older clients still send and which
  // `getMediaImages` normalizes. If this regressed, historical media would vanish
  // from the panel while remaining visible in the thread.
  test("the legacy single-image payload yields one ref", () => {
    const refs = extractSharedRefs({
      height: 9,
      kind: "image",
      type: "media",
      url: "/api/media/legacy",
      width: 8,
    });
    expect(refs?.media).toHaveLength(1);
    expect(refs?.media[0]).toMatchObject({
      height: 9,
      imageIndex: 0,
      url: "/api/media/legacy",
      width: 8,
    });
  });

  test("a link in a media caption is recorded, because the transcript unfurls it", () => {
    const refs = extractSharedRefs({
      content: "shot of https://example.com/article",
      images: [{ url: "/api/media/a" }],
      kind: "image",
      type: "media",
    });
    expect(refs?.links).toEqual(["https://example.com/article"]);
    expect(refs?.media).toHaveLength(1);
  });

  test("links are sanitized, deduped and capped exactly as the bubble unfurls them", () => {
    const refs = extractSharedRefs(
      text(
        "https://example.com/a?utm_source=nl https://example.com/a and https://example.com/b"
      )
    );
    // Tracking stripped, and the tracked and untracked forms are one link.
    expect(refs?.links).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  test("a plain text message has no refs at all", () => {
    expect(extractSharedRefs(text("just talking"))).toBeNull();
  });

  test("a message with nothing to show reports null rather than empty lists", () => {
    // Null and empty mean different things to the writer: "no refs stored" is the
    // state a re-walk skips, so an empty record would claim coverage it does not
    // have.
    expect(extractSharedRefs(text(""))).toBeNull();
    expect(extractSharedRefs({ postId: "p1", type: "post" })?.postIds).toEqual([
      "p1",
    ]);
  });

  // The writer's own fixtures are built from a deliberately loose view of a
  // payload, and they run through this extractor, so a missing field has to
  // degrade to "no ref" rather than to a stored row that resolves to nothing.
  test("a payload missing its post id contributes no post share", () => {
    const malformed = { type: "post" } as unknown as MessagePayload;
    expect(extractSharedRefs(malformed)).toBeNull();
  });

  test("a payload with a null caption contributes no links", () => {
    const malformed = {
      content: null,
      postId: "p1",
      type: "post",
    } as unknown as MessagePayload;
    expect(extractSharedRefs(malformed)).toMatchObject({ postIds: ["p1"] });
  });

  test("a media payload with a hole in its images skips the hole", () => {
    const malformed = {
      images: [{ url: "/api/media/a" }, null, { url: "/api/media/c" }],
      kind: "image",
      type: "media",
    } as unknown as MessagePayload;
    const refs = extractSharedRefs(malformed);
    expect(refs?.media.map((image) => image.url)).toEqual([
      "/api/media/a",
      "/api/media/c",
    ]);
    // The surviving images keep their ALBUM positions, not renumbered ones: the
    // index is the viewer's anchor into the transcript.
    expect(refs?.media.map((image) => image.imageIndex)).toEqual([0, 2]);
  });
});

describe("sharedRefsEqual", () => {
  test("identical content is equal", () => {
    expect(
      sharedRefsEqual(
        extractSharedRefs(text("https://example.com/a")),
        extractSharedRefs(text("https://example.com/a"))
      )
    ).toBe(true);
  });

  // This comparison is what decides whether a re-index is skipped, and a false
  // "equal" here is the bug that leaves the panel showing a link the author has
  // since removed. Swapping a link changes no word.
  test("a different link is not equal, even though the text tokens are identical", () => {
    expect(
      sharedRefsEqual(
        extractSharedRefs(text("look at https://example.com/a")),
        extractSharedRefs(text("look at https://example.com/b"))
      )
    ).toBe(false);
  });

  test("a different image count is not equal", () => {
    const one = extractSharedRefs({
      images: [{ url: "/api/media/a" }],
      kind: "image",
      type: "media",
    });
    const two = extractSharedRefs({
      images: [{ url: "/api/media/a" }, { url: "/api/media/b" }],
      kind: "image",
      type: "media",
    });
    expect(sharedRefsEqual(one, two)).toBe(false);
  });

  test("a gif swapped for a still image is not equal, though every url matches", () => {
    const still = extractSharedRefs({
      images: [{ url: "/api/media/a" }],
      kind: "image",
      type: "media",
    });
    const gif = extractSharedRefs({
      images: [{ url: "/api/media/a" }],
      kind: "gif",
      type: "media",
    });
    expect(sharedRefsEqual(still, gif)).toBe(false);
  });

  test("reordered links are not equal", () => {
    expect(
      sharedRefsEqual(
        extractSharedRefs(text("https://example.com/a https://example.com/b")),
        extractSharedRefs(text("https://example.com/b https://example.com/a"))
      )
    ).toBe(false);
  });

  test("null is equal only to null", () => {
    const some = extractSharedRefs(text("https://example.com/a"));
    expect(sharedRefsEqual(null, null)).toBe(true);
    expect(sharedRefsEqual(null, some)).toBe(false);
    expect(sharedRefsEqual(some, null)).toBe(false);
  });
});
