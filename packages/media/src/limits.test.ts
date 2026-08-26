import { describe, expect, test } from "bun:test";

import { DEFAULT_LIMITS, maxBytesForType, resolveMediaLimits } from "./limits";

describe("media limits", () => {
  test("defaults are generous and match product ceilings", () => {
    expect(DEFAULT_LIMITS.maxVideoBytes).toBe(250 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxImageBytes).toBe(25 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxAudioBytes).toBe(50 * 1024 * 1024);
    expect(DEFAULT_LIMITS.maxPixelCount).toBeGreaterThan(50_000_000);
    expect(DEFAULT_LIMITS.maxFilesPerRequest).toBe(5);
  });

  test("resolveMediaLimits returns defaults when env is empty", () => {
    expect(resolveMediaLimits({})).toEqual(DEFAULT_LIMITS);
  });

  test("env overrides apply per key", () => {
    const limits = resolveMediaLimits({
      MEDIA_MAX_VIDEO_BYTES: "1048576",
      MEDIA_UPLOADS_PER_DAY: "10",
    });
    expect(limits.maxVideoBytes).toBe(1_048_576);
    expect(limits.maxUploadsPerDayPerUser).toBe(10);
    // Untouched keys keep defaults.
    expect(limits.maxImageBytes).toBe(DEFAULT_LIMITS.maxImageBytes);
  });

  test("garbage env values fall back to defaults instead of throwing", () => {
    const limits = resolveMediaLimits({
      MEDIA_MAX_FPS: "-5",
      MEDIA_MAX_IMAGE_BYTES: "not-a-number",
      MEDIA_MAX_PIXEL_COUNT: "",
    });
    expect(limits.maxImageBytes).toBe(DEFAULT_LIMITS.maxImageBytes);
    expect(limits.maxFps).toBe(DEFAULT_LIMITS.maxFps);
    expect(limits.maxPixelCount).toBe(DEFAULT_LIMITS.maxPixelCount);
  });

  test("maxBytesForType maps categories to caps", () => {
    expect(maxBytesForType(DEFAULT_LIMITS, "IMAGE")).toBe(
      DEFAULT_LIMITS.maxImageBytes
    );
    expect(maxBytesForType(DEFAULT_LIMITS, "VIDEO")).toBe(
      DEFAULT_LIMITS.maxVideoBytes
    );
    expect(maxBytesForType(DEFAULT_LIMITS, "AUDIO")).toBe(
      DEFAULT_LIMITS.maxAudioBytes
    );
    expect(maxBytesForType(DEFAULT_LIMITS, "DOCUMENT")).toBe(
      DEFAULT_LIMITS.maxDocumentBytes
    );
    expect(maxBytesForType(DEFAULT_LIMITS, "NOPE")).toBe(0);
  });
});
