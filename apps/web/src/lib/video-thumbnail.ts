import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { imageSize } from "image-size";

// Frame grabbed ~2s in (matches the hover-preview seek used across the UI);
// very short clips fall back to the first frame instead.
const THUMBNAIL_SEEK_SECONDS = 2;
const FFMPEG_TIMEOUT_MS = 30_000;

interface VideoThumbnail {
  buffer: Buffer;
  height: number | null;
  width: number | null;
}

const execFileAsync = promisify(execFile);

async function runCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: FFMPEG_TIMEOUT_MS,
  });
  return stdout;
}

async function probeDuration(inputPath: string): Promise<number | null> {
  try {
    const stdout = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) ? duration : null;
  } catch {
    // ffprobe may be missing or the container odd; extraction below will fall
    // back to seeking from 0 which is always safe.
    return null;
  }
}

/**
 * Extracts a JPEG thumbnail from a video buffer. Returns null when ffmpeg is
 * not installed or extraction fails, so uploads never break on missing tooling.
 */
export async function extractVideoThumbnail(
  buffer: Buffer,
  fileExtension = "mp4"
): Promise<VideoThumbnail | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "asm-thumb-"));
  const inputPath = path.join(dir, `input.${fileExtension || "mp4"}`);
  const outputPath = path.join(dir, "thumb.jpg");

  try {
    await writeFile(inputPath, buffer);

    const duration = await probeDuration(inputPath);
    const seek =
      duration !== null && duration > THUMBNAIL_SEEK_SECONDS + 0.5
        ? THUMBNAIL_SEEK_SECONDS
        : 0;

    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      String(seek),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath,
    ]);

    const thumbnail = await readFile(outputPath);
    let width: number | null = null;
    let height: number | null = null;
    try {
      const dimensions = imageSize(new Uint8Array(thumbnail));
      width = dimensions.width ?? null;
      height = dimensions.height ?? null;
    } catch {
      // Dimensions are a nice-to-have; a missing header read must not fail the
      // upload after the frame was already extracted.
    }

    return { buffer: thumbnail, height, width };
  } catch (error) {
    console.error("Video thumbnail extraction failed:", error);
    return null;
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => {
      /* empty */
    });
  }
}
