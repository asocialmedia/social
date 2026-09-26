import { describe, expect, test } from "bun:test";

import {
  coverCrop,
  isAnimatedImage,
  isTooLarge,
  PROFILE_IMAGE_MAX_BYTES,
  ProfileImageError,
} from "./profile-media-crop";

// The cover-crop is the part worth pinning: it decides the output dimensions
// and the framing, and it runs before the network on every avatar and banner.
// The expectations below are web's own numbers - a 512 square avatar and a
// 1500x500 banner - so a regression shows up as the wrong pixel size.

const AVATAR = { height: 512, width: 512 };
const BANNER = { height: 500, width: 1500 };

describe("coverCrop", () => {
  test("a square source fills a square avatar with no offset", () => {
    const crop = coverCrop(AVATAR, { height: 1024, width: 1024 });
    expect(crop.height).toBe(512);
    expect(crop.width).toBe(512);
    expect(crop.originX).toBe(0);
    expect(crop.originY).toBe(0);
  });

  test("a wide source is cropped horizontally and stays centred", () => {
    const crop = coverCrop(AVATAR, { height: 1000, width: 2000 });
    expect(crop.height).toBe(512);
    expect(crop.width).toBe(512);
    expect(crop.originY).toBe(0);
    // 2000x1000 is 2:1, so height binds: 512 tall, 1024 wide, middle 512 kept.
    expect(crop.originX).toBe(256);
  });

  test("a tall source is cropped vertically and stays centred", () => {
    const crop = coverCrop(AVATAR, { height: 2000, width: 1000 });
    expect(crop.width).toBe(512);
    expect(crop.height).toBe(512);
    expect(crop.originX).toBe(0);
    expect(crop.originY).toBe(256);
  });

  test("a 3:1 source lands on the banner box with no crop", () => {
    const crop = coverCrop(BANNER, { height: 1000, width: 3000 });
    expect(crop.width).toBe(1500);
    expect(crop.height).toBe(500);
    expect(crop.originX).toBe(0);
    expect(crop.originY).toBe(0);
  });

  test("a 16:9 source becomes a 3:1 banner, cropping top and bottom evenly", () => {
    const crop = coverCrop(BANNER, { height: 1080, width: 1920 });
    expect(crop.width).toBe(1500);
    expect(crop.height).toBe(500);
    expect(crop.originX).toBe(0);
    // 1920x1080 is wider than 3:1, so height binds: 1500x844, middle 500 kept.
    expect(crop.originY).toBe(172);
  });

  test("a 9:16 source becomes a 3:1 banner by cropping top and bottom", () => {
    const crop = coverCrop(BANNER, { height: 1920, width: 1080 });
    expect(crop.width).toBe(1500);
    expect(crop.height).toBe(500);
    // Portrait binds on width: scaled to 1500x2667, so the middle 500-tall band
    // is taken from 1084px down.
    expect(crop.originX).toBe(0);
    expect(crop.originY).toBe(1084);
  });

  test("a square source on a banner scales up rather than letterboxing", () => {
    const crop = coverCrop(BANNER, { height: 1000, width: 1000 });
    expect(crop.width).toBe(1500);
    expect(crop.height).toBe(500);
    expect(crop.originX).toBe(0);
    // Scaled to a 1500 square, so the band starts a third of the way down.
    expect(crop.originY).toBe(500);
  });

  test("a source smaller than the target is scaled up, never cropped", () => {
    const crop = coverCrop(AVATAR, { height: 100, width: 100 });
    expect(crop.width).toBe(512);
    expect(crop.height).toBe(512);
    expect(crop.originX).toBe(0);
    expect(crop.originY).toBe(0);
  });

  test("a degenerate zero-dimension source cannot produce a zero crop", () => {
    const crop = coverCrop(AVATAR, { height: 0, width: 0 });
    expect(crop.width).toBeGreaterThan(0);
    expect(crop.height).toBeGreaterThan(0);
  });

  test("an extremely wide source still yields exactly the target width", () => {
    const crop = coverCrop(BANNER, { height: 100, width: 10_000 });
    expect(crop.width).toBe(1500);
    expect(crop.height).toBe(500);
  });
});

describe("ProfileImageError", () => {
  test("carries the reason so the caller can word the toast", () => {
    const tooLarge = new ProfileImageError("too-large", "over 10MB");
    expect(tooLarge.reason).toBe("too-large");
    expect(tooLarge.message).toBe("over 10MB");
    expect(tooLarge).toBeInstanceOf(Error);
  });
});

describe("isTooLarge", () => {
  test("matches web's 10MB ceiling exactly", () => {
    expect(PROFILE_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(isTooLarge(PROFILE_IMAGE_MAX_BYTES)).toBe(false);
    expect(isTooLarge(PROFILE_IMAGE_MAX_BYTES + 1)).toBe(true);
  });
});

describe("isAnimatedImage", () => {
  test("catches a gif by mime type and by extension", () => {
    expect(isAnimatedImage("image/gif", "avatar.jpg")).toBe(true);
    expect(isAnimatedImage(undefined, "banner.GIF")).toBe(true);
    expect(isAnimatedImage("image/jpeg", "avatar.jpg")).toBe(false);
    expect(isAnimatedImage(undefined, "avatar.png")).toBe(false);
  });
});
