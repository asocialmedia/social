import { afterAll, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "asm-raster-fallback-"));
const validPath = path.join(directory, "valid.png");
const invalidPath = path.join(directory, "invalid.webp");
const legacyPath = path.join(directory, "legacy.webp");
const legacy = await sharp({
  create: { background: "green", channels: 3, height: 12, width: 15 },
})
  .webp()
  .toBuffer();
legacy.writeUInt32LE(legacy.length - 20, 8);
await Bun.write(legacyPath, legacy);
await sharp({
  create: { background: "red", channels: 3, height: 16, width: 20 },
})
  .png()
  .toFile(validPath);
await Bun.write(invalidPath, "not an image");
const reads: string[] = [];
mock.module("../../s3", () => ({
  getS3: () => ({
    file: (key: string) => {
      reads.push(key);
      if (key === "corrupt") {
        return Bun.file(invalidPath);
      }
      if (key === "valid") {
        return Bun.file(validPath);
      }
      if (key === "oversized") {
        return Bun.file(path.join(directory, "oversized.riff"));
      }
      if (key === "legacy") {
        return Bun.file(legacyPath);
      }
      return Bun.file(path.join(directory, "missing"));
    },
  }),
}));
const { downloadAnalysisRaster } = await import("./raster-source");
afterAll(() => rm(directory, { force: true, recursive: true }));

test("missing and unsupported derivatives fall back to a decodable source", async () => {
  const output = path.join(directory, "result.jpg");
  expect(
    await downloadAnalysisRaster(
      ["missing", "corrupt", "valid", "valid"],
      output
    )
  ).toBe(output);
  expect(reads).toEqual(["missing", "corrupt", "valid"]);
  const metadata = await sharp(output).metadata();
  expect(metadata.format).toBe("jpeg");
  expect(await readdir(directory)).not.toContain("result.jpg-input");
});

test("exhausted sources report decode versus storage failures and remove partial files", async () => {
  const output = path.join(directory, "failed.jpg");
  await expect(
    downloadAnalysisRaster(["missing", "corrupt"], output)
  ).rejects.toMatchObject({
    attempts: 2,
    decodeFailures: 1,
    name: "AnalysisRasterError",
  });
  expect(await Bun.file(output).exists()).toBe(false);
  expect(await Bun.file(`${output}-input`).exists()).toBe(false);
  expect(await downloadAnalysisRaster([], output)).toBeNull();
});

test("analysis repairs the exact legacy WebP header without modifying stored bytes", async () => {
  const output = path.join(directory, "repaired.jpg");
  expect(await downloadAnalysisRaster(["legacy"], output)).toBe(output);
  const metadata = await sharp(output).metadata();
  expect(metadata.format).toBe("jpeg");
  expect(
    Buffer.from(await Bun.file(legacyPath).arrayBuffer()).equals(legacy)
  ).toBe(true);
});

test("oversized non-WebP RIFF files skip in-memory repair and fall back to a valid image", async () => {
  const input = path.join(directory, "oversized.riff");
  await Bun.write(input, "RIFF0000WAVE");
  await truncate(input, 50 * 1024 * 1024 + 1);
  const output = path.join(directory, "bounded.jpg");
  expect(await downloadAnalysisRaster(["oversized", "valid"], output)).toBe(
    output
  );
  const metadata = await sharp(output).metadata();
  expect(metadata.format).toBe("jpeg");
});
