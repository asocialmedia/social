import { afterAll, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "asm-raster-fallback-"));
const validPath = path.join(directory, "valid.png");
const invalidPath = path.join(directory, "invalid.webp");
await sharp({
  create: { background: "red", channels: 3, height: 16, width: 20 },
})
  .png()
  .toFile(validPath);
await Bun.write(invalidPath, "not an image");
const reads: string[] = [];
mock.module("../s3", () => ({
  getS3: () => ({
    file: (key: string) => {
      reads.push(key);
      if (key === "corrupt") {
        return Bun.file(invalidPath);
      }
      if (key === "valid") {
        return Bun.file(validPath);
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
