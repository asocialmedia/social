import { describe, expect, test } from "bun:test";

import { detectAiFromXmp, readMediaIdentityXmp } from "@asm/media";
import sharp from "sharp";

import { watermarkImageBuffer } from "./image";

describe("portable identity without pixel degradation", () => {
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
