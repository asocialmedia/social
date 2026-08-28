import { describe, expect, test } from "bun:test";

import { UnrecoverableError } from "bullmq";

import {
  dHash64,
  enforceDecoderLimits,
  parseRate,
  ResourceLimitError,
  withTimeout,
} from "./ffmpeg";

describe("dHash64 perceptual hashing", () => {
  test("uniform pixels hash to zero (no horizontal gradients)", () => {
    const pixels = new Uint8Array(72).fill(128);
    expect(dHash64(pixels)).toBe("0000000000000000");
  });

  test("strict left-to-right gradient sets every bit", () => {
    // Strictly decreasing luminance across all 9 columns makes every
    // horizontal comparison true.
    const pixels = new Uint8Array(8 * 9);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        pixels[y * 9 + x] = Math.max(0, 100 - x * 12);
      }
    }
    expect(dHash64(pixels)).toBe("ffffffffffffffff");
  });

  test("hash is deterministic and sensitive to flips", () => {
    const a = new Uint8Array(72);
    for (let i = 0; i < 9; i += 1) {
      a[i] = i * 20;
    }
    const b = new Uint8Array(a);
    b[4] = 255;
    expect(dHash64(a)).toBe(dHash64(a));
    expect(dHash64(a)).not.toBe(dHash64(b));
  });

  test("bit order is row-major LSB-first", () => {
    // Exactly one true comparison: row 0, x=0.
    const pixels = new Uint8Array(72).fill(10);
    pixels[0] = 20;
    pixels[1] = 10;
    pixels[2] = 10;
    expect(dHash64(pixels)).toBe("0000000000000001");
  });
});

describe("ffmpeg rate parsing", () => {
  test("fractional frame rates", () => {
    expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseRate("30/1")).toBe(30);
  });

  test("garbage input yields zero", () => {
    // Via a typed variable: passing a literal undefined gets autofixed to an
    // implicit call by oxlint, which then fails TypeScript's required arity.
    const missing: string | undefined = undefined;
    expect(parseRate(missing)).toBe(0);
    expect(parseRate("")).toBe(0);
    expect(parseRate("N/A")).toBe(0);
    expect(parseRate("5/0")).toBe(0);
  });
});

describe("decoder resource limits", () => {
  const baseLimits = {
    maxBitrateKbps: 20_000,
    maxDimension: 20_000,
    maxFps: 60,
    maxVideoDurationSec: 30 * 60,
  };

  const baseProbe = {
    audio: null,
    container: "mp4",
    durationSec: 600,
    formatBitrateKbps: 5000,
    video: {
      bitrateKbps: 4500,
      codec: "h264",
      colorSpace: undefined,
      colorTransfer: undefined,
      fps: 30,
      frameRateMode: "CFR" as const,
      height: 1080,
      pix_fmt: "yuv420p",
      pixelFormat: "yuv420p",
      rotation: 0,
      width: 1920,
    },
  };

  test("a compliant stream passes untouched", () => {
    expect(() => enforceDecoderLimits(baseProbe, baseLimits)).not.toThrow();
  });

  test("over-duration streams are rejected", () => {
    expect(() =>
      enforceDecoderLimits({ ...baseProbe, durationSec: 31 * 60 }, baseLimits)
    ).toThrow(ResourceLimitError);
  });

  test("over-fps streams are rejected", () => {
    const video = { ...baseProbe.video, fps: 240 };
    expect(() =>
      enforceDecoderLimits({ ...baseProbe, video }, baseLimits)
    ).toThrow(ResourceLimitError);
  });

  test("over-bitrate streams are rejected", () => {
    expect(() =>
      enforceDecoderLimits(
        { ...baseProbe, formatBitrateKbps: 25_000 },
        baseLimits
      )
    ).toThrow(ResourceLimitError);
  });

  test("over-dimension streams are rejected on either axis", () => {
    const wide = { ...baseProbe.video, width: 30_000 };
    const tall = { ...baseProbe.video, height: 30_000 };
    expect(() =>
      enforceDecoderLimits({ ...baseProbe, video: wide }, baseLimits)
    ).toThrow(ResourceLimitError);
    expect(() =>
      enforceDecoderLimits({ ...baseProbe, video: tall }, baseLimits)
    ).toThrow(ResourceLimitError);
  });

  test("audio-only probes skip video checks but keep duration/bitrate", () => {
    const audioOnly = { ...baseProbe, video: null };
    expect(() => enforceDecoderLimits(audioOnly, baseLimits)).not.toThrow();
    expect(() =>
      enforceDecoderLimits({ ...audioOnly, durationSec: 61 * 60 }, baseLimits)
    ).toThrow(ResourceLimitError);
  });

  test("policy rejections are unrecoverable so BullMQ skips remaining attempts", () => {
    const error = new ResourceLimitError("bitrate 38792kbps exceeds limit");
    expect(error).toBeInstanceOf(UnrecoverableError);
    // The failed-handler keys on this name to mark the media row.
    expect(error.name).toBe("ResourceLimitError");
  });

  test("withTimeout resolves fast work and rejects slow work", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "late")).resolves.toBe(
      7
    );
    await expect(
      // eslint-disable-next-line promise/avoid-new -- a never-settling promise is the point of the deadline test
      withTimeout(new Promise<never>(() => {}), 10, "deadline hit")
    ).rejects.toThrow("deadline hit");
  });
});
