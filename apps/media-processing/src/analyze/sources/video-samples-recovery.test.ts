import { afterAll, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const directory = await mkdtemp(path.join(tmpdir(), "asm-sample-recovery-"));
let failAll = false;
mock.module("../../transcode/ffmpeg", () => ({
  probeMedia: () => Promise.resolve({ durationSec: 10 }),
  runFfmpeg: async (args: string[]) => {
    const output = args.at(-1);
    if (!output || output === "-") {
      return "";
    }
    if (failAll || output.endsWith("sample-1.jpg")) {
      await Bun.write(output, "partial output");
      throw new Error("ffmpeg timed out after 15000ms");
    }
    await sharp({
      create: {
        background: output.endsWith("sample-0.jpg") ? "red" : "blue",
        channels: 3,
        height: 20,
        width: 20,
      },
    })
      .jpeg()
      .toFile(output);
    return "";
  },
}));
const { extractVideoSamples } = await import("./video-samples");
afterAll(() => rm(directory, { force: true, recursive: true }));

test("a failed frame and a duplicate retain previously validated samples", async () => {
  const paths: string[] = [];
  await extractVideoSamples(path.join(directory, "video"), paths);
  expect(paths).toEqual([
    path.join(directory, "video-sample-0.jpg"),
    path.join(directory, "video-sample-2.jpg"),
  ]);
  const files = await readdir(directory);
  expect(files.toSorted()).toEqual([
    "video-sample-0.jpg",
    "video-sample-2.jpg",
  ]);
});

test("no decodable samples propagates the diagnostic and removes partial files", async () => {
  failAll = true;
  const paths: string[] = [];
  await expect(
    extractVideoSamples(path.join(directory, "failed"), paths)
  ).rejects.toThrow("timed out");
  expect(paths).toEqual([]);
  const files = await readdir(directory);
  expect(files.some((file) => file.startsWith("failed"))).toBe(false);
});
