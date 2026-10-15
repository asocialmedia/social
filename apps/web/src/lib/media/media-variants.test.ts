import { describe, expect, test } from "bun:test";

import {
  DERIVATIVE_MIME_BY_EXT,
  isSafeHlsFilename,
  parseVariantRequest,
  hlsGeneration,
  hlsGenerationKey,
  pinHlsManifest,
} from "./media-variants";

describe("variant request parsing", () => {
  test("pins every HLS URI to one generation during background upgrades", () => {
    const generation = "v4.11111111-1111-4111-8111-111111111111";
    const key =
      "derived/v4/media/11111111-1111-4111-8111-111111111111/hls/master.m3u8";
    expect(hlsGeneration(key)).toBe(generation);
    expect(hlsGenerationKey("media", generation, "seg-360p-0000.m4s")).toBe(
      key.replace("master.m3u8", "seg-360p-0000.m4s")
    );
    expect(
      hlsGenerationKey("media", "../../quarantine", "master.m3u8")
    ).toBeNull();
    const manifest = pinHlsManifest(
      '#EXTM3U\n#EXT-X-MAP:URI="init-360p.mp4"\nseg-360p-0000.m4s\n720p.m3u8\n',
      generation
    );
    expect(manifest).toContain(`init-360p.mp4?g=${generation}`);
    expect(manifest).toContain(`seg-360p-0000.m4s?g=${generation}`);
    expect(manifest).toContain(`720p.m3u8?g=${generation}`);
  });
  test("qualified kind-variant.ext forms", () => {
    expect(parseVariantRequest(["thumb-webp.webp"])).toEqual({
      kind: "thumb",
      variant: "webp",
    });
    expect(parseVariantRequest(["md-jpeg.jpg"])).toEqual({
      kind: "md",
      variant: "jpeg",
    });
    expect(parseVariantRequest(["orig-img-webp.webp"])).toEqual({
      kind: "orig-img",
      variant: "webp",
    });
  });

  test("audio/video derivative names parse to their DB kinds", () => {
    expect(parseVariantRequest(["mp4-h264.mp4"])).toEqual({
      kind: "mp4",
      variant: "h264",
    });
    expect(parseVariantRequest(["audio-aac.m4a"])).toEqual({
      kind: "audio",
      variant: "aac",
    });
    expect(parseVariantRequest(["audio-opus.webm"])).toEqual({
      kind: "audio",
      variant: "opus",
    });
  });

  test("simple poster/cover names map to the default variant", () => {
    expect(parseVariantRequest(["poster.jpg"])).toEqual({
      kind: "poster",
      variant: "default",
    });
  });

  test("hls namespace resolves only through the hls/ prefix", () => {
    expect(parseVariantRequest(["hls", "master.m3u8"])).toEqual({
      hlsFile: "master.m3u8",
    });
    expect(parseVariantRequest(["hls", "seg-720p-0001.m4s"])).toEqual({
      hlsFile: "seg-720p-0001.m4s",
    });
    // The qualified parser must not alias the reserved hls namespace.
    expect(parseVariantRequest(["hls-master.m3u8"])).toBeNull();
  });

  test("traversal and injection attempts fail closed", () => {
    expect(
      parseVariantRequest(["..%2F..%2Fquarantine%2Fx%2Foriginal.jpg"])
    ).toBeNull();
    expect(parseVariantRequest(["../../original.jpg"])).toBeNull();
    expect(parseVariantRequest(["hls/../secret.m3u8"])).toBeNull();
    expect(parseVariantRequest(["thumb-webp.svg"])).toBeNull();
    expect(parseVariantRequest(["thumb-webp.html"])).toBeNull();
    expect(parseVariantRequest([`${"x".repeat(210)}.jpg`])).toBeNull();
    expect(parseVariantRequest([])).toBeNull();
  });

  test("segment filename safety", () => {
    expect(isSafeHlsFilename("seg-360p-0042.m4s")).toBe(true);
    expect(isSafeHlsFilename("init-1080p.mp4")).toBe(true);
    expect(isSafeHlsFilename("../evil")).toBe(false);
    expect(isSafeHlsFilename("a/b.m4s")).toBe(false);
    expect(isSafeHlsFilename("payload.js")).toBe(false);
  });

  test("mime table covers every served extension", () => {
    for (const extension of [
      "webp",
      "jpg",
      "json",
      "m3u8",
      "m4s",
      "mp4",
      "m4a",
      "webm",
    ]) {
      expect(DERIVATIVE_MIME_BY_EXT[extension]).toBeDefined();
    }
  });
});
