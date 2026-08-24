import { describe, expect, test } from "bun:test";

import {
  derivativeKey,
  derivativeName,
  hlsBaseFromMasterKey,
  isSafeHlsFilename,
  publishedKey,
  quarantineKey,
  sanitizeExtension,
} from "./keys";

describe("storage key layout", () => {
  test("quarantine keys are namespaced per media id", () => {
    expect(quarantineKey("abc123", "jpg")).toBe(
      "quarantine/abc123/original.jpg"
    );
  });

  test("published keys embed a content-hash fragment", () => {
    const key = publishedKey("abc123", "png", "deadbeef1234567890");
    expect(key).toBe("media/abc123/original-deadbeef12345678.png");
  });

  test("derivative keys are versioned and deterministic", () => {
    const a = derivativeKey("1", "m1", "thumb-webp");
    const b = derivativeKey("1", "m1", "thumb-webp");
    expect(a).toBe(b);
    expect(a).toBe("derived/v1/m1/thumb-webp");
  });

  test("derivative names combine kind, variant and extension", () => {
    expect(derivativeName("poster", "default", "jpg")).toBe("poster.jpg");
    expect(derivativeName("hls", "720p", "m3u8")).toBe("hls-720p.m3u8");
  });

  test("sanitizeExtension neutralizes traversal and weird input", () => {
    // Path junk is stripped and the result capped at 5 chars.
    expect(sanitizeExtension("../../etc/passwd")).toBe("etcpa");
    expect(sanitizeExtension("JPG")).toBe("jpg");
    expect(sanitizeExtension("")).toBe("bin");
    expect(sanitizeExtension(null)).toBe("bin");
    expect(sanitizeExtension(".jpeg-extra-long-name")).not.toContain(".");
  });
});

describe("hls filename safety", () => {
  test("base is derived from the master key directory", () => {
    expect(hlsBaseFromMasterKey("derived/v1/m1/hls-master.m3u8")).toBe(
      "derived/v1/m1"
    );
    expect(hlsBaseFromMasterKey("master.m3u8")).toBe("");
  });

  test("safe segment filenames pass", () => {
    expect(isSafeHlsFilename("seg-720p-0001.m4s")).toBe(true);
    expect(isSafeHlsFilename("master.m3u8")).toBe(true);
    expect(isSafeHlsFilename("init-360p.mp4")).toBe(true);
  });

  test("traversal and protocol tricks fail closed", () => {
    expect(isSafeHlsFilename("../original.jpg")).toBe(false);
    expect(isSafeHlsFilename("a/b.m4s")).toBe(false);
    expect(isSafeHlsFilename("..%2F..%2Fsecret")).toBe(false);
    expect(isSafeHlsFilename("payload.js")).toBe(false);
    expect(isSafeHlsFilename("no-extension")).toBe(false);
  });
});
