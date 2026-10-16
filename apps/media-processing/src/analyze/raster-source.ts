import sharp from "sharp";

import { getS3 } from "../s3";

export class AnalysisRasterError extends Error {
  readonly attempts: number;
  readonly decodeFailures: number;
  constructor(attempts: number, decodeFailures: number) {
    super(
      `No usable analysis raster (${attempts} sources tried, ${decodeFailures} decode failures)`
    );
    this.name = "AnalysisRasterError";
    this.attempts = attempts;
    this.decodeFailures = decodeFailures;
  }
}

// Validate a complete decode before selecting a derivative. Missing or stale
// derivatives must not hide a surviving published image or original.
export async function downloadAnalysisRaster(
  keys: readonly string[],
  outputPath: string
): Promise<string | null> {
  const candidates = [...new Set(keys.filter(Boolean))];
  let decodeFailures = 0;
  for (const key of candidates) {
    const inputPath = `${outputPath}-input`;
    try {
      // oxlint-disable-next-line no-await-in-loop -- fallback depends on the previous source failing.
      await Bun.write(inputPath, getS3().file(key));
      try {
        // oxlint-disable-next-line no-await-in-loop -- validate each candidate before selecting it.
        await sharp(inputPath, { limitInputPixels: 100_000_000 })
          .autoOrient()
          .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
          .flatten({ background: "white" })
          .toColourspace("srgb")
          .jpeg({ quality: 95 })
          .toFile(outputPath);
      } catch {
        decodeFailures += 1;
        continue;
      }
      return outputPath;
    } catch {
      // Try the next stored candidate without logging private object keys.
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- remove each candidate before downloading its replacement.
      await Bun.file(inputPath)
        .delete()
        .catch(() => null);
    }
  }
  await Bun.file(outputPath)
    .delete()
    .catch(() => null);
  if (candidates.length) {
    throw new AnalysisRasterError(candidates.length, decodeFailures);
  }
  return null;
}
