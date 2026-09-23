import { describe, expect, test } from "bun:test";

import {
  assertUploadable,
  canAddMedia,
  familyFromMime,
  MAX_POST_ATTACHMENTS,
  planParts,
  UploadPolicyError,
} from "./upload-policy";

describe("familyFromMime", () => {
  test("maps mime prefixes to families", () => {
    expect(familyFromMime("image/jpeg")).toBe("IMAGE");
    expect(familyFromMime("video/mp4")).toBe("VIDEO");
    expect(familyFromMime("audio/mpeg")).toBe("AUDIO");
  });

  test("hard-blocks svg, text and unknown families", () => {
    expect(() => familyFromMime("image/svg+xml")).toThrow(UploadPolicyError);
    expect(() => familyFromMime("text/plain")).toThrow(UploadPolicyError);
    expect(() => familyFromMime("application/pdf")).toThrow(UploadPolicyError);
  });
});

describe("assertUploadable", () => {
  test("accepts files within the family cap", () => {
    expect(assertUploadable("image/png", 1024)).toBe("IMAGE");
  });

  test("rejects empty and oversized files with web's caps", () => {
    expect(() => assertUploadable("image/png", 0)).toThrow("empty");
    expect(() => assertUploadable("image/png", 26 * 1024 * 1024)).toThrow(
      "Images can be up to 25MB."
    );
    expect(() => assertUploadable("video/mp4", 251 * 1024 * 1024)).toThrow(
      "Videos can be up to 250MB."
    );
  });
});

describe("planParts", () => {
  test("splits into 1-based parts with the remainder last", () => {
    expect(planParts(10, 4)).toEqual([
      { end: 4, partNumber: 1, start: 0 },
      { end: 8, partNumber: 2, start: 4 },
      { end: 10, partNumber: 3, start: 8 },
    ]);
  });

  test("handles exact multiples and empty input", () => {
    expect(planParts(8, 4)).toHaveLength(2);
    expect(planParts(0, 4)).toEqual([]);
  });
});

describe("canAddMedia", () => {
  const image = { family: "IMAGE" as const, isGif: false };
  const video = { family: "VIDEO" as const, isGif: false };
  const audio = { family: "AUDIO" as const, isGif: false };
  const gif = { family: "IMAGE" as const, isGif: true };

  test("mixes images and videos", () => {
    expect(canAddMedia([image], video)).toEqual({ ok: true });
  });

  test("keeps audio and gifs exclusive", () => {
    expect(canAddMedia([image], audio)).toEqual({
      ok: false,
      reason: "exclusive",
    });
    expect(canAddMedia([gif], image)).toEqual({
      ok: false,
      reason: "exclusive",
    });
    expect(canAddMedia([], audio)).toEqual({ ok: true });
  });

  test("caps a post at the attachment limit", () => {
    const full = Array.from({ length: MAX_POST_ATTACHMENTS }, () => image);
    expect(canAddMedia(full, image)).toEqual({ ok: false, reason: "limit" });
  });

  test("gusts take exactly one video", () => {
    expect(canAddMedia([], video, { gust: true })).toEqual({ ok: true });
    expect(canAddMedia([], image, { gust: true })).toEqual({
      ok: false,
      reason: "gust",
    });
  });
});
