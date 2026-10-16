import { describe, expect, test } from "bun:test";

import {
  detectAiFromXmp,
  readMediaIdentityXmp,
  stripImageMetadata,
} from "@asm/media";
import sharp from "sharp";

import { watermarkImageBuffer } from "./image";

describe("portable identity without pixel degradation", () => {
  test("WebP privacy scrub produces a decodable container with identical pixels", async () => {
    const source = await sharp({
      create: { background: "orange", channels: 3, height: 35, width: 67 },
    })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">private-camera-data</x:xmpmeta>'
      )
      .webp()
      .toBuffer();
    const scrubbed = stripImageMetadata(source);
    expect(scrubbed?.stripped).toBe(true);
    if (!scrubbed) {
      throw new Error("Expected scrubbed WebP");
    }
    const bytes = Buffer.from(scrubbed.bytes);
    const metadata = await sharp(bytes).metadata();
    expect(metadata.xmp).toBeUndefined();
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    const before = await sharp(source).raw().toBuffer();
    const after = await sharp(bytes).raw().toBuffer();
    expect(before.equals(after)).toBe(true);
  });
  test("animated WebP keeps both frames and timing through scrub and identity stamping", async () => {
    const pixels = Buffer.alloc(16 * 32 * 3);
    pixels.fill(40, 0, 16 * 16 * 3);
    pixels.fill(210, 16 * 16 * 3);
    const source = await sharp(pixels, {
      raw: { channels: 3, height: 32, pageHeight: 16, width: 16 },
    })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">private-data</x:xmpmeta>')
      .webp({ delay: [100, 200], loop: 0, lossless: true })
      .toBuffer();
    const scrubbed = stripImageMetadata(source);
    if (!scrubbed) {
      throw new Error("Expected animated WebP scrub");
    }
    const stamped = await watermarkImageBuffer(
      Buffer.from(scrubbed.bytes),
      { hashedUploaderId: null, mediaId: "animated_123", version: 1 },
      1_000_000
    );
    if (!stamped) {
      throw new Error("Expected animated identity");
    }
    const metadata = await sharp(stamped, { animated: true }).metadata();
    expect(metadata.pages).toBe(2);
    expect(metadata.delay).toEqual([100, 200]);
    expect(readMediaIdentityXmp(metadata.xmp?.toString())).toBe("animated_123");
    const before = await sharp(source, { animated: true }).raw().toBuffer();
    const after = await sharp(stamped, { animated: true }).raw().toBuffer();
    expect(before.equals(after)).toBe(true);
  });
  for (const format of ["jpeg", "png", "webp"] as const) {
    test(`${format} keeps decoded pixels and original format`, async () => {
      const source = await sharp({
        create: {
          background: { alpha: 0.5, b: 17, g: 60, r: 180 },
          channels: 4,
          height: 19,
          width: 31,
        },
      })
        .toFormat(format)
        .toBuffer();
      const stamped = await watermarkImageBuffer(
        source,
        { hashedUploaderId: null, mediaId: "asset_123", version: 1 },
        1_000_000,
        true
      );
      expect(stamped).not.toBeNull();
      if (!stamped) {
        throw new Error("Expected a stamped image");
      }
      const metadata = await sharp(stamped).metadata();
      expect(metadata.format).toBe(format);
      expect(readMediaIdentityXmp(metadata.xmp?.toString())).toBe("asset_123");
      expect(detectAiFromXmp(metadata.xmp?.toString()).aiGenerated).toBe(true);
      const before = await sharp(source).ensureAlpha().raw().toBuffer();
      const after = await sharp(stamped).ensureAlpha().raw().toBuffer();
      expect(before.equals(after)).toBe(true);
    });
  }
});
