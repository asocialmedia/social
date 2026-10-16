import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

import { runFfmpeg } from "../transcode/ffmpeg";
import { extractVideoSamples } from "./video-samples";

test("real FFmpeg sampling removes repeated frames and retains distinct scenes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "asm-scenes-"));
  try {
    const input = path.join(directory, "scenes.mp4");
    await runFfmpeg(
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=128x128:r=10:d=2",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=128x128:r=10:d=2",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[out]",
        "-map",
        "[out]",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-y",
        input,
      ],
      15_000
    );
    const frames: string[] = [];
    await extractVideoSamples(input, frames);
    expect(frames).toHaveLength(2);
    const colors = await Promise.all(
      frames.map(async (frame) => {
        const { channels } = await sharp(frame).stats();
        return (channels[0]?.mean ?? 0) > (channels[2]?.mean ?? 0)
          ? "red"
          : "blue";
      })
    );
    expect(new Set(colors)).toEqual(new Set(["red", "blue"]));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}, 30_000);
