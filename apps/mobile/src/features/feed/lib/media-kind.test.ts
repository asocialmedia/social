import { describe, expect, test } from "bun:test";

import { hasVideoAttachment, isVideoMediaType } from "./media-kind";

describe("hasVideoAttachment", () => {
  test("accepts a post with a video attachment", () => {
    expect(hasVideoAttachment({ attachments: [{ type: "VIDEO" }] })).toBe(true);
  });

  test("rejects image-only and attachment-less posts", () => {
    // A text-only post must never take the autoplay slot, or it would blank
    // out playback for the video just below it.
    expect(hasVideoAttachment({ attachments: [{ type: "IMAGE" }] })).toBe(
      false
    );
    expect(hasVideoAttachment({ attachments: [] })).toBe(false);
    expect(hasVideoAttachment({})).toBe(false);
  });

  test("tolerates a malformed attachment entry", () => {
    const malformed = {
      attachments: [null, { type: "VIDEO" }],
    } as unknown as { attachments: { type?: string | null }[] };
    expect(hasVideoAttachment(malformed)).toBe(true);
  });

  test("isVideoMediaType only matches VIDEO", () => {
    expect(isVideoMediaType("VIDEO")).toBe(true);
    expect(isVideoMediaType("IMAGE")).toBe(false);
    expect(isVideoMediaType(null)).toBe(false);
  });
});
