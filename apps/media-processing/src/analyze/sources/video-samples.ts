import sharp from "sharp";

import { probeMedia, runFfmpeg } from "../../transcode/ffmpeg";

export function sampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [0];
  }
  return [
    ...new Set(
      [0.1, 0.4, 0.7, 0.9].map((fraction) =>
        Math.max(0, Math.min(duration - 0.05, duration * fraction))
      )
    ),
  ];
}

export function sceneTimestamp(
  log: string,
  anchor: number,
  windowSeconds: number
): number {
  const match = /pts_time:(?<seconds>\d+(?:\.\d+)?)/.exec(log);
  const relative = Number(match?.groups?.seconds);
  return match &&
    Number.isFinite(relative) &&
    relative >= 0 &&
    relative <= windowSeconds
    ? anchor + relative
    : anchor;
}

export function similarFrame(
  a: Uint8Array,
  b: Uint8Array,
  threshold = 3
): boolean {
  if (!a.length || a.length !== b.length) {
    return false;
  }
  const difference =
    a.reduce(
      (total, value, index) => total + Math.abs(value - (b[index] ?? 0)),
      0
    ) / a.length;
  return difference <= threshold;
}

// Inspect at most four 4-second windows, then send at most four distinct frames.
export async function extractVideoSamples(
  inputPath: string,
  paths: string[]
): Promise<void> {
  const probe = await probeMedia(inputPath);
  const thumbnails: Uint8Array[] = [];
  let lastError: unknown = null;
  for (const [index, anchor] of sampleTimes(probe.durationSec).entries()) {
    let seek = anchor;
    const window = Math.min(4, Math.max(0.05, probe.durationSec - anchor));
    // Preserve the opening anchor before searching later windows for scene cuts.
    if (index > 0) {
      try {
        const log = await runFfmpeg(
          [
            "-ss",
            String(anchor),
            "-i",
            inputPath,
            "-t",
            String(window),
            "-an",
            "-vf",
            "scale=160:-2,select='gt(scene,0.3)',showinfo",
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
          ],
          8000,
          "info"
        );
        seek = sceneTimestamp(log, anchor, window);
      } catch {
        // Decoder timeout or no detected cut retains the evenly spaced fallback.
      }
    }
    const path = `${inputPath}-sample-${index}.jpg`;
    // Keep only validated frames; a failed late sample must not discard earlier ones.
    try {
      await runFfmpeg(
        [
          "-ss",
          String(Math.min(seek, Math.max(0, probe.durationSec - 0.05))),
          "-i",
          inputPath,
          "-frames:v",
          "1",
          "-vf",
          "scale=768:768:force_original_aspect_ratio=decrease",
          "-q:v",
          "3",
          "-y",
          path,
        ],
        15_000
      );
      const thumbnail = await sharp(path)
        .resize(16, 16, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer();
      if (thumbnails.some((previous) => similarFrame(previous, thumbnail))) {
        await Bun.file(path).delete();
      } else {
        thumbnails.push(thumbnail);
        paths.push(path);
      }
    } catch (error) {
      lastError = error;
      await Bun.file(path)
        .delete()
        .catch(() => null);
    }
  }
  if (!paths.length && lastError) {
    throw lastError;
  }
}
