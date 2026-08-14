import { describe, expect, test } from "bun:test";

import {
  getMediaProxyUrl,
  getSecureImageUrl,
  toAppProxyUrl,
} from "./image-url";

describe("getSecureImageUrl & toAppProxyUrl", () => {
  test("rewrites raw object storage avatar URLs to app proxy paths", () => {
    const rawUrl =
      "http://localhost:9090/uploads/avatars/cmsoxce3j0003m4vngsw7r7ay/1786565964201-avatar.png";
    expect(getSecureImageUrl(rawUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image"
    );
    expect(toAppProxyUrl(rawUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image"
    );
  });

  test("rewrites URL-encoded object storage avatar URLs (%2F) to app proxy paths", () => {
    const encodedUrl =
      "http://localhost:9090/uploads/avatars%2Fcmsoxce3j0003m4vngsw7r7ay%2F1786565964201-392.png";
    expect(getSecureImageUrl(encodedUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image"
    );
    expect(toAppProxyUrl(encodedUrl)).toBe(
      "/api/users/avatar/cmsoxce3j0003m4vngsw7r7ay/image"
    );
  });

  test("rewrites object storage banner URLs to app banner proxy paths", () => {
    const bannerUrl =
      "http://localhost:9090/uploads/banners%2Fcmsoxce3j0003m4vngsw7r7ay%2F1786565964201-banner.png";
    expect(getSecureImageUrl(bannerUrl)).toBe(
      "/api/users/banner/cmsoxce3j0003m4vngsw7r7ay/image"
    );
    expect(toAppProxyUrl(bannerUrl)).toBe(
      "/api/users/banner/cmsoxce3j0003m4vngsw7r7ay/image"
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

  test("builds media proxy URL with thumbnail parameter for videos with thumbnails", () => {
    expect(
      getMediaProxyUrl({
        id: "media123",
        thumbnailKey: "media/thumb-123.jpg",
        type: "VIDEO",
      })
    ).toBe("/api/media/media123?thumb=1");

    expect(
      getMediaProxyUrl({
        id: "media456",
        thumbnailKey: null,
        type: "IMAGE",
      })
    ).toBe("/api/media/media456");
  });
});
