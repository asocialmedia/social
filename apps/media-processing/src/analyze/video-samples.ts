import { probeMedia, runFfmpeg } from "../transcode/ffmpeg";

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

export async function extractVideoSamples(
  inputPath: string,
  paths: string[]
): Promise<void> {
  const probe = await probeMedia(inputPath);
  for (const [index, seek] of sampleTimes(probe.durationSec).entries()) {
    const path = `${inputPath}-sample-${index}.jpg`;
    paths.push(path);
    await runFfmpeg(
      [
        "-ss",
        String(seek),
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
  }
}
