import { describe, expect, test } from "bun:test";

import {
  DEFAULT_AVATARS,
  getDefaultAvatar,
  getMediaImageUrl,
  getMediaProxyUrl,
  getMediaVariantUrl,
  getMediaVideoUrl,
  getSecureImageUrl,
  toAppProxyUrl,
} from "./image-url";

describe("getDefaultAvatar", () => {
  test("returns a valid default avatar URL", () => {
    expect(DEFAULT_AVATARS).toContain(getDefaultAvatar());
    expect(DEFAULT_AVATARS).toContain(getDefaultAvatar("user-123"));
    expect(DEFAULT_AVATARS).toContain(getDefaultAvatar("user-456"));
  });

  test("returns deterministic result for the same seed", () => {
    expect(getDefaultAvatar("user-123")).toBe(getDefaultAvatar("user-123"));
    expect(getDefaultAvatar("arya_yadawwww")).toBe(
      getDefaultAvatar("arya_yadawwww")
    );
  });
});

describe("getSecureImageUrl & toAppProxyUrl", () => {
  test("rewrites raw object storage avatar URLs to app proxy paths", () => {
    const rawUrl =
      "http://localhost:9090/uploads/avatars/cmsoxce3j0003m4vngsw7r7ay/1786565964201-avatar.png";
    expect(getSecureImageUrl(rawUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image?v=1786565964201-avatar.png"
    );
    expect(toAppProxyUrl(rawUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image?v=1786565964201-avatar.png"
    );
  });

  test("rewrites URL-encoded object storage avatar URLs (%2F) to app proxy paths", () => {
    const encodedUrl =
      "http://localhost:9090/uploads/avatars%2Fcmsoxce3j0003m4vngsw7r7ay%2F1786565964201-392.png";
    expect(getSecureImageUrl(encodedUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image?v=1786565964201-392.png"
    );
    expect(toAppProxyUrl(encodedUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image?v=1786565964201-392.png"
    );
  });

  test("rewrites object storage banner URLs to app banner proxy paths", () => {
    const bannerUrl =
      "http://localhost:9090/uploads/banners%2Fcmsoxce3j0003m4vngsw7r7ay%2F1786565964201-banner.png";
    expect(getSecureImageUrl(bannerUrl)).toBe(
      "/api/users/banner/cmsoxce3j0003m4vngsw7r7ay/image?v=1786565964201-banner.png"
    );
    expect(toAppProxyUrl(bannerUrl)).toBe(
      "/api/users/banner/cmsoxce3j0003m4vngsw7r7ay/image?v=1786565964201-banner.png"
    );
  });

  test("returns empty string when input is empty or null", () => {
    expect(getSecureImageUrl("")).toBe("");
    expect(toAppProxyUrl(null)).toBe("");
    expect(toAppProxyUrl()).toBe("");
  });

  test("leaves external image URLs intact without causing SSR hydration mismatches", () => {
    const externalUrl = "https://images.unsplash.com/photo-12345";
    expect(getSecureImageUrl(externalUrl)).toBe(externalUrl);
  });

  test("normalizes absolute default avatar URLs to relative static asset paths", () => {
    const defaultAvatar = "https://asocialmedia.cc/avatars/default-2.png";
    expect(getSecureImageUrl(defaultAvatar)).toBe("/avatars/default-2.png");
    expect(toAppProxyUrl(defaultAvatar)).toBe("/avatars/default-2.png");

    const localhostAvatar = "https://social.localhost/avatars/default-1.png";
    expect(getSecureImageUrl(localhostAvatar)).toBe("/avatars/default-1.png");
    expect(toAppProxyUrl(localhostAvatar)).toBe("/avatars/default-1.png");
  });

  test("does not modify relative default avatar paths", () => {
    expect(getSecureImageUrl("/avatars/default-1.png")).toBe(
      "/avatars/default-1.png"
    );
    expect(toAppProxyUrl("/avatars/default-1.png")).toBe(
      "/avatars/default-1.png"
    );
  });

  test("builds media proxy URL with thumbnail parameter for videos with thumbnails", () => {
    expect(
      getMediaProxyUrl({
        id: "media123",
        thumbnailKey: "media/thumb-123.jpg",
        type: "VIDEO",
      })
    ).toBe("/api/media/media123?thumb=1");
  });

  test("feed images request the 800px WebP derivative through the variant route", () => {
    expect(
      getMediaProxyUrl({
        id: "media456",
        mimeType: "image/jpeg",
        thumbnailKey: null,
        type: "IMAGE",
      })
    ).toBe("/api/media/media456/v/md-webp.webp");

    expect(
      getMediaProxyUrl({
        id: "media789",
        mimeType: "image/png",
        thumbnailKey: null,
        type: "IMAGE",
      })
    ).toBe("/api/media/media789/v/md-webp.webp");
  });

  test("animated GIFs bypass the variant route so their animation survives", () => {
    expect(
      getMediaProxyUrl({
        id: "mediaGif",
        mimeType: "image/gif",
        thumbnailKey: null,
        type: "IMAGE",
      })
    ).toBe("/api/media/mediaGif");
  });

  test("video playback prefers the progressive MP4 derivative", () => {
    expect(getMediaVideoUrl("mediaVid")).toBe(
      "/api/media/mediaVid/v/mp4-h264.mp4"
    );
    // Variant URLs are always safe: the route falls back to the published
    // original when the derivative has not been generated.
    expect(getMediaVariantUrl("mediaX", "lg-webp.webp")).toBe(
      "/api/media/mediaX/v/lg-webp.webp"
    );
  });

  test("getMediaImageUrl requests any derivative size with GIF passthrough", () => {
    expect(
      getMediaImageUrl({ id: "m1", mimeType: "image/jpeg" }, "lg-webp.webp")
    ).toBe("/api/media/m1/v/lg-webp.webp");
    expect(
      getMediaImageUrl(
        { id: "m2", mimeType: "image/png" },
        "orig-img-webp.webp"
      )
    ).toBe("/api/media/m2/v/orig-img-webp.webp");
    // Animated GIFs keep their original bytes at every requested size.
    expect(
      getMediaImageUrl(
        { id: "m3", mimeType: "image/gif" },
        "orig-img-webp.webp"
      )
    ).toBe("/api/media/m3");
  });
});
