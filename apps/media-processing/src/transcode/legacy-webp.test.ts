import { expect, test } from "bun:test";

import sharp from "sharp";

import { prepareLegacyWebpRepair } from "./legacy-webp";

test.each([3, 4] as const)(
  "legacy WebP repair preserves %s-channel pixels and the damaged source",
  async (channels) => {
    const original = await sharp({
      create: {
        background: { alpha: 0.5, b: 90, g: 60, r: 30 },
        channels,
        height: 35,
        width: 67,
      },
    })
      .withIccProfile("srgb")
      .webp()
      .toBuffer();
    const damaged = Buffer.from(original);
    damaged.writeUInt32LE(damaged.length - 20, 8);
    const repair = await prepareLegacyWebpRepair(damaged, "legacy-image");
    expect(repair?.bytes.equals(original)).toBe(true);
    expect(damaged.toString("ascii", 8, 12)).not.toBe("WEBP");
    expect(repair?.key).toStartWith("media/legacy-image/original-");
    const decoded = await sharp(repair?.bytes).raw().toBuffer();
    expect(decoded.equals(await sharp(original).raw().toBuffer())).toBe(true);
  }
);

test("repair rejects healthy images, unrelated RIFF data and truncated legacy chunks", async () => {
  const original = await sharp({
    create: { background: "orange", channels: 3, height: 10, width: 10 },
  })
    .webp()
    .toBuffer();
  expect(await prepareLegacyWebpRepair(original, "id")).toBeNull();
  const unrelated = Buffer.alloc(32);
  unrelated.write("RIFF", 0);
  unrelated.writeUInt32LE(24, 4);
  unrelated.writeUInt32LE(12, 8);
  unrelated.write("WAVE", 12);
  expect(await prepareLegacyWebpRepair(unrelated, "id")).toBeNull();
  const truncated = Buffer.from(original);
  truncated.writeUInt32LE(truncated.length - 20, 8);
  truncated.writeUInt32LE(truncated.length, 16);
  expect(await prepareLegacyWebpRepair(truncated, "id")).toBeNull();
});
