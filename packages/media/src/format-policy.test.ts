import { describe, expect, test } from "bun:test";

import {
  avContainerExtension,
  classifyImage,
  isAvMetadataStripContainer,
  needsFaststart,
  planImageDerivatives,
  planVideoOutputs,
} from "./format-policy";

describe("image classification", () => {
  test("animation wins over alpha and entropy", () => {
    expect(
      classifyImage({
        colorEntropy: 0.9,
        hasAlpha: true,
        height: 100,
        isAnimated: true,
        isLosslessSource: false,
        width: 100,
      })
    ).toBe("animated");
  });

  test("alpha sources are their own class", () => {
    expect(
      classifyImage({
        colorEntropy: 0.9,
        hasAlpha: true,
        height: 100,
        isAnimated: false,
        isLosslessSource: false,
        width: 100,
      })
    ).toBe("alpha");
  });

  test("low color entropy means graphic", () => {
    expect(
      classifyImage({
        colorEntropy: 0.1,
        hasAlpha: false,
        height: 100,
        isAnimated: false,
        isLosslessSource: true,
        width: 100,
      })
    ).toBe("graphic");
    expect(
      classifyImage({
        colorEntropy: 0.8,
        hasAlpha: false,
        height: 100,
        isAnimated: false,
        isLosslessSource: false,
        width: 100,
      })
    ).toBe("photo");
  });
});

describe("image derivative planning", () => {
  const photo = {
    colorEntropy: 0.9,
    hasAlpha: false,
    height: 2000,
    isAnimated: false,
    isLosslessSource: false,
    width: 1600,
  };

  test("never upscales: small sources get only smaller rungs", () => {
    const plan = planImageDerivatives({
      ...photo,
      height: 500,
      width: 500,
    });
    const widths = plan.map((d) => d.width);
    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(500);
    }
    // thumb(320) + md-jpeg? no - md(800) exceeds source; thumb + its jpeg fallback.
    expect(plan.some((d) => d.kind === "thumb" && d.variant === "webp")).toBe(
      true
    );
    expect(plan.some((d) => d.kind === "lg")).toBe(false);
  });

  test("large photo gets the full ladder plus jpeg fallbacks", () => {
    const plan = planImageDerivatives(photo);
    const kinds = new Set(plan.map((d) => d.kind));
    expect(kinds.has("thumb")).toBe(true);
    expect(kinds.has("sm")).toBe(true);
    expect(kinds.has("md")).toBe(true);
    expect(kinds.has("lg")).toBe(true);
    expect(kinds.has("orig-img")).toBe(true);
    expect(plan.filter((d) => d.variant === "jpeg").map((d) => d.kind)).toEqual(
      ["thumb", "md"]
    );
  });

  test("orig-img stays lossy for photographic sources", () => {
    const plan = planImageDerivatives(photo);
    const orig = plan.find((d) => d.kind === "orig-img");
    expect(orig?.lossless).toBe(false);
    // Even a PNG upload classified as photo stays perceptual - a lossless
    // encode of noisy photographic content would dwarf the upload.
    const pngPhoto = planImageDerivatives({
      ...photo,
      isLosslessSource: true,
    });
    expect(pngPhoto.find((d) => d.kind === "orig-img")?.lossless).toBe(false);
  });

  test("lossless graphics and alpha sources get bit-exact orig-img", () => {
    const screenshot = planImageDerivatives({
      ...photo,
      colorEntropy: 0.1,
      height: 2160,
      isLosslessSource: true,
      width: 3840,
    });
    expect(screenshot.find((d) => d.kind === "orig-img")?.lossless).toBe(true);

    const logo = planImageDerivatives({
      ...photo,
      colorEntropy: 0.9,
      hasAlpha: true,
      height: 512,
      isLosslessSource: true,
      width: 512,
    });
    expect(logo.find((d) => d.kind === "orig-img")?.lossless).toBe(true);

    // Same graphic uploaded as a lossy JPEG keeps perceptual encoding.
    const jpegGraphic = planImageDerivatives({
      ...photo,
      colorEntropy: 0.1,
      height: 2160,
      isLosslessSource: false,
      width: 3840,
    });
    expect(jpegGraphic.find((d) => d.kind === "orig-img")?.lossless).toBe(
      false
    );
  });

  test("sources beyond the orig ceiling fall back to ladder rungs only", () => {
    const plan = planImageDerivatives({ ...photo, height: 6000, width: 5000 });
    expect(plan.some((d) => d.kind === "orig-img")).toBe(false);
    expect(plan.some((d) => d.kind === "lg")).toBe(true);
  });

  test("animated sources skip the orig re-encode (original bytes serve motion)", () => {
    const plan = planImageDerivatives({
      ...photo,
      height: 500,
      isAnimated: true,
      width: 500,
    });
    expect(plan.some((d) => d.kind === "orig-img")).toBe(false);
  });

  test("degenerate dimensions produce nothing", () => {
    expect(planImageDerivatives({ ...photo, height: 0, width: 0 })).toEqual([]);
  });

  test("aspect ratio preserved on every rung", () => {
    const plan = planImageDerivatives(photo);
    for (const d of plan) {
      const expectedHeight = Math.max(
        1,
        Math.round((photo.height / photo.width) * d.width)
      );
      expect(d.height).toBe(expectedHeight);
    }
  });
});

describe("video output planning", () => {
  test("short clips are progressive-only, no HLS overhead", () => {
    const plan = planVideoOutputs({ durationSec: 30, srcHeight: 1080 });
    expect(plan.progressiveMp4).toBe(true);
    expect(plan.hls).toBe(false);
    expect(plan.hlsLadder).toEqual([]);
    expect(plan.poster).toBe(true);
  });

  test("long videos get HLS with a ladder capped at source height", () => {
    const plan = planVideoOutputs({ durationSec: 600, srcHeight: 720 });
    expect(plan.hls).toBe(true);
    expect(plan.hlsLadder.map((r) => r.variant)).toEqual([
      "360p",
      "480p",
      "720p",
    ]);
  });

  test("4K source gets the full ladder including 1080p", () => {
    const plan = planVideoOutputs({ durationSec: 120, srcHeight: 2160 });
    expect(plan.hlsLadder.map((r) => r.variant)).toEqual([
      "360p",
      "480p",
      "720p",
      "1080p",
    ]);
  });

  test("tiny-but-long sources still stream at the lowest rung", () => {
    const plan = planVideoOutputs({ durationSec: 300, srcHeight: 144 });
    expect(plan.hls).toBe(true);
    expect(plan.hlsLadder.map((r) => r.variant)).toEqual(["360p"]);
  });
});

describe("published-original av metadata policy", () => {
  test("every content-detectable video/audio container is strip-eligible", () => {
    // These are exactly the `container` values magic.ts can emit for the
    // VIDEO/AUDIO families - a gap here would publish an unscrubbed original.
    for (const container of [
      "iso-bmff",
      "mov",
      "m4a",
      "webm",
      "mkv",
      "avi",
      "flv",
      "mpeg-audio",
      "ogg",
      "flac",
      "wav",
      "aac-adts",
    ]) {
      expect(isAvMetadataStripContainer(container)).toBe(true);
    }
  });

  test("image containers are never remux-scrubbed", () => {
    for (const container of ["jpeg", "png", "gif", "webp", "heic"]) {
      expect(isAvMetadataStripContainer(container)).toBe(false);
    }
  });

  test("container extensions map to real ffmpeg muxers", () => {
    expect(avContainerExtension("iso-bmff")).toBe("mp4");
    expect(avContainerExtension("mov")).toBe("mov");
    expect(avContainerExtension("m4a")).toBe("m4a");
    expect(avContainerExtension("webm")).toBe("webm");
    expect(avContainerExtension("mkv")).toBe("mkv");
    expect(avContainerExtension("avi")).toBe("avi");
    expect(avContainerExtension("flv")).toBe("flv");
    expect(avContainerExtension("mpeg-audio")).toBe("mp3");
    expect(avContainerExtension("ogg")).toBe("ogg");
    expect(avContainerExtension("flac")).toBe("flac");
    expect(avContainerExtension("wav")).toBe("wav");
    expect(avContainerExtension("aac-adts")).toBe("aac");
    expect(avContainerExtension("jpeg")).toBeNull();
    expect(avContainerExtension("unknown")).toBeNull();
  });

  test("only the ISO-BMFF family faststarts", () => {
    expect(needsFaststart("iso-bmff")).toBe(true);
    expect(needsFaststart("mov")).toBe(true);
    expect(needsFaststart("m4a")).toBe(true);
    expect(needsFaststart("webm")).toBe(false);
    expect(needsFaststart("mkv")).toBe(false);
    expect(needsFaststart("mpeg-audio")).toBe(false);
  });
});
