import { describe, expect, test } from "bun:test";

import {
  avatarExtension,
  avatarInitial,
  canSatoriRenderAvatar,
} from "./og-avatar";

// Satori bundles support for PNG, JPEG, GIF and SVG only. Avatars published by
// the media pipeline are WebP, and an <img> pointing at one produces
// "Can't load image ...: Unsupported image type: image/webp" on every card
// render - with the failure memoised by source URL for the life of the process.
describe("canSatoriRenderAvatar", () => {
  test("accepts the formats Satori can decode", () => {
    for (const key of [
      "avatars/user/a.png",
      "avatars/user/a.jpg",
      "avatars/user/a.jpeg",
      "avatars/user/a.gif",
      "avatars/user/a.svg",
      "avatars/user/a.PNG",
    ]) {
      expect(canSatoriRenderAvatar(key)).toBe(true);
    }
  });

  test("rejects WebP and AVIF, which Satori cannot decode", () => {
    for (const key of [
      "avatars/user/a.webp",
      "avatars/user/a.avif",
      "avatars/user/a.WEBP",
    ]) {
      expect(canSatoriRenderAvatar(key)).toBe(false);
    }
  });

  test("rejects a missing or extension-less key rather than guessing", () => {
    expect(canSatoriRenderAvatar(null)).toBe(false);
    expect(canSatoriRenderAvatar()).toBe(false);
    expect(canSatoriRenderAvatar("")).toBe(false);
    expect(canSatoriRenderAvatar("avatars/user/avatar")).toBe(false);
  });

  test("ignores a query string when reading the extension", () => {
    expect(avatarExtension("avatars/user/a.png?v=2")).toBe("png");
    expect(canSatoriRenderAvatar("avatars/user/a.jpg?v=abc#frag")).toBe(true);
  });
});

describe("avatarInitial", () => {
  test("prefers the display name", () => {
    expect(avatarInitial("nova", "novauser")).toBe("N");
  });

  test("falls back to the username, then to a placeholder", () => {
    expect(avatarInitial(null, "novauser")).toBe("N");
    expect(avatarInitial("", "novauser")).toBe("N");
    expect(avatarInitial(null, null)).toBe("?");
    expect(avatarInitial()).toBe("?");
  });
});
