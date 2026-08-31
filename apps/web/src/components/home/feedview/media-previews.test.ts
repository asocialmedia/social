import { describe, expect, test } from "bun:test";

import type { Media } from "@asm/db";

import { formatTime, mediaAspectRatio } from "./media-previews";

describe("mediaAspectRatio", () => {
  test("returns natural aspect ratio string when width and height are provided", () => {
    const portraitMedia = {
      height: 1920,
      width: 1080,
    } as Media;
    expect(mediaAspectRatio(portraitMedia)).toBe("1080 / 1920");

    const landscapeMedia = {
      height: 1080,
      width: 1920,
    } as Media;
    expect(mediaAspectRatio(landscapeMedia)).toBe("1920 / 1080");

    const squareMedia = {
      height: 1000,
      width: 1000,
    } as Media;
    expect(mediaAspectRatio(squareMedia)).toBe("1000 / 1000");
  });

  test("returns fallback when width or height is missing or non-positive", () => {
    const noDimsMedia = {} as Media;
    expect(mediaAspectRatio(noDimsMedia)).toBe("1 / 1");
    expect(mediaAspectRatio(noDimsMedia, "16 / 9")).toBe("16 / 9");

    const zeroDimsMedia = {
      height: 0,
      width: 1080,
    } as Media;
    expect(mediaAspectRatio(zeroDimsMedia, "16 / 9")).toBe("16 / 9");
  });
});

describe("formatTime", () => {
  test("formats seconds into mm:ss properly", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  test("handles negative or invalid numbers", () => {
    expect(formatTime(-10)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
