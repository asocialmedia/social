import { describe, expect, test } from "bun:test";

import {
  DEFAULT_LIMITS,
  planImageDerivatives,
  detectAiFromXmp,
} from "@asm/media";
import sharp from "sharp";

import { encodeImageDerivative, inspectImage } from "./image";

describe("real image codecs", () => {
  test("classifies decoded pixels, including transparent palette PNGs", async () => {
    const png = await sharp({
      create: {
        background: { alpha: 0.5, b: 60, g: 40, r: 220 },
        channels: 4,
        height: 320,
        width: 640,
      },
    })
      .png({ palette: true })
      .toBuffer();
    const info = await inspectImage(png, DEFAULT_LIMITS);
    expect(info.hasAlpha).toBe(true);
    expect(info.entropy).toBeLessThan(0.01);
    expect(info.animated).toBe(false);
    const plan = planImageDerivatives({
      ...info,
      colorEntropy: info.entropy,
      isAnimated: false,
      isLosslessSource: true,
    });
    const rung = plan.find(
      (entry) => entry.kind === "orig-img" && entry.variant === "webp"
    );
    expect(rung?.lossless).toBe(true);
    if (!rung) {
      throw new Error("Missing lossless rung");
    }
    const encoded = await encodeImageDerivative(png, rung, DEFAULT_LIMITS);
    if (!encoded) {
      throw new Error("Expected WebP derivative");
    }
    const sourcePixels = await sharp(png).ensureAlpha().raw().toBuffer();
    const outputPixels = await sharp(encoded.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(outputPixels.equals(sourcePixels)).toBe(true);
  });
  test("decodes AVIF on Linux and applies orientation before sizing", async () => {
    const jpeg = await sharp({
      create: { background: "orange", channels: 3, height: 320, width: 640 },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const info = await inspectImage(jpeg, DEFAULT_LIMITS);
    expect([info.width, info.height]).toEqual([320, 640]);
    const encoded = await encodeImageDerivative(
      jpeg,
      { height: 320, kind: "thumb", quality: 65, variant: "avif", width: 160 },
      DEFAULT_LIMITS
    );
    if (!encoded) {
      throw new Error("Expected AVIF derivative");
    }
    const output = await inspectImage(encoded.bytes, DEFAULT_LIMITS);
    expect([output.width, output.height]).toEqual([160, 320]);
    const outputMetadata = await sharp(encoded.bytes).metadata();
    expect(outputMetadata.exif).toBeUndefined();
    const labeled = await encodeImageDerivative(
      jpeg,
      { height: 320, kind: "thumb", quality: 65, variant: "avif", width: 160 },
      DEFAULT_LIMITS,
      "asset_123",
      true
    );
    if (!labeled) {
      throw new Error("Expected labeled AVIF derivative");
    }
    const labeledMetadata = await sharp(labeled.bytes).metadata();
    expect(detectAiFromXmp(labeledMetadata.xmp?.toString()).aiGenerated).toBe(
      true
    );
  });
  test("rejects over-budget decodes", async () => {
    const png = await sharp({
      create: { background: "blue", channels: 3, height: 100, width: 100 },
    })
      .png()
      .toBuffer();
    await expect(
      inspectImage(png, { ...DEFAULT_LIMITS, maxPixelCount: 99 })
    ).rejects.toThrow();
  });
});
