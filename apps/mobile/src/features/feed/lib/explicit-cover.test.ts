import { expect, test } from "bun:test";

import {
  canBlurExplicitCover,
  explicitCoverUrl,
  supportsExplicitBlur,
} from "./explicit-cover";

test("explicit GIFs use a still derivative rather than the animated original", () => {
  expect(
    explicitCoverUrl("https://example.test", {
      id: "gif",
      mimeType: "image/gif",
      type: "IMAGE",
    })
  ).toBe("https://example.test/api/media/gif/v/md-webp.webp?d=4");
  expect(
    explicitCoverUrl("https://example.test", { id: "video", type: "VIDEO" })
  ).toBe("https://example.test/api/media/video?thumb=1");
  expect(
    explicitCoverUrl("https://example.test", { id: "audio", type: "AUDIO" })
  ).toBeNull();
});

test("an animated fallback stays concealed when a still derivative is unavailable", () => {
  expect(canBlurExplicitCover({ isAnimated: true, mediaType: null })).toBe(
    false
  );
  expect(canBlurExplicitCover({ mediaType: "image/gif" })).toBe(false);
  expect(
    canBlurExplicitCover({ isAnimated: false, mediaType: "image/webp" })
  ).toBe(true);
  expect(supportsExplicitBlur("android", 30)).toBe(false);
  expect(supportsExplicitBlur("android", 31)).toBe(true);
  expect(supportsExplicitBlur("android", 36)).toBe(true);
  expect(supportsExplicitBlur("ios", "18")).toBe(true);
});

test("a concealed Bluesky video parent uses its poster rather than the HLS playlist", () => {
  expect(
    explicitCoverUrl("https://example.test", {
      id: "https://video.bsky.app/playlist.m3u8",
      thumbnailKey: "https://video.bsky.app/thumbnail.jpg",
      type: "VIDEO",
    })
  ).toBe("https://video.bsky.app/thumbnail.jpg");
});
