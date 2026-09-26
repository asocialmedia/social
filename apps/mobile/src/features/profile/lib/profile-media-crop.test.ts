import { describe, expect, test } from "bun:test";

import {
  isAnimatedImage,
  isTooLarge,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_RATIO,
  ProfileImageError,
  ratioDrift,
} from "./profile-media-crop";

describe("isTooLarge", () => {
  test("matches web's 10MB ceiling exactly", () => {
    expect(PROFILE_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(isTooLarge(PROFILE_IMAGE_MAX_BYTES)).toBe(false);
    expect(isTooLarge(PROFILE_IMAGE_MAX_BYTES - 1)).toBe(false);
    expect(isTooLarge(PROFILE_IMAGE_MAX_BYTES + 1)).toBe(true);
  });
});

describe("isAnimatedImage", () => {
  test("catches a gif by mime type and by extension", () => {
    expect(isAnimatedImage("image/gif", "avatar.jpg")).toBe(true);
    expect(isAnimatedImage(undefined, "banner.GIF")).toBe(true);
    expect(isAnimatedImage("image/GIF", "banner.png")).toBe(true);
  });

  test("leaves still images alone", () => {
    expect(isAnimatedImage("image/jpeg", "avatar.jpg")).toBe(false);
    expect(isAnimatedImage("image/png", "avatar.PNG")).toBe(false);
    expect(isAnimatedImage(undefined, "avatar.webp")).toBe(false);
    // A name that merely contains "gif" is not a gif.
    expect(isAnimatedImage("image/jpeg", "my-gift.jpg")).toBe(false);
  });
});

describe("ratioDrift", () => {
  test("is zero for the exact target ratio", () => {
    expect(ratioDrift("avatar", 512, 512)).toBe(0);
    expect(ratioDrift("banner", 1500, 500)).toBe(0);
  });

  test("is positive but under 1 for a close match", () => {
    expect(ratioDrift("avatar", 1100, 1000)).toBeCloseTo(0.1);
    expect(ratioDrift("banner", 1600, 500)).toBeCloseTo(0.0666, 3);
  });

  test("flags a badly mismatched source", () => {
    expect(ratioDrift("banner", 1000, 1000)).toBeCloseTo(2 / 3);
    expect(ratioDrift("avatar", 1600, 500)).toBeCloseTo(2.2);
  });

  test("treats a degenerate size as no drift rather than NaN", () => {
    expect(ratioDrift("avatar", 0, 0)).toBe(0);
    expect(ratioDrift("banner", 100, 0)).toBe(0);
  });
});

describe("PROFILE_IMAGE_RATIO", () => {
  test("matches the ratios the surfaces render at", () => {
    expect(PROFILE_IMAGE_RATIO.avatar).toBe(1);
    expect(PROFILE_IMAGE_RATIO.banner).toBe(3);
  });
});

describe("ProfileImageError", () => {
  test("carries the reason so the caller can word the toast", () => {
    const tooLarge = new ProfileImageError("too-large", "over 10MB");
    expect(tooLarge.reason).toBe("too-large");
    expect(tooLarge.message).toBe("over 10MB");
    expect(tooLarge).toBeInstanceOf(Error);
  });

  test("names itself so logs are readable", () => {
    expect(new ProfileImageError("unusable", "nope").name).toBe(
      "ProfileImageError"
    );
  });
});
