import sharp from "sharp";

import { getS3 } from "../s3";
import { prepareLegacyWebpRepair } from "../transcode/legacy-webp";

export class AnalysisRasterError extends Error {
  readonly attempts: number;
  readonly decodeFailures: number;
  constructor(attempts: number, decodeFailures: number, reason?: string) {
    super(
      `No usable analysis raster (${attempts} sources tried, ${decodeFailures} decode failures)${reason ? `: ${reason}` : ""}`
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
  let reason: string | undefined;
  for (const key of candidates) {
    const inputPath = `${outputPath}-input`;
    try {
      // oxlint-disable-next-line no-await-in-loop -- fallback depends on the previous source failing.
      await Bun.write(inputPath, getS3().file(key));
      // Recognize the exact old RIFF-header defect before asking the decoder to read it.
      // oxlint-disable-next-line no-await-in-loop -- inspect one downloaded candidate at a time.
      const header = Buffer.from(
        await Bun.file(inputPath).slice(0, 12).arrayBuffer()
      );
      if (
        header.toString("ascii", 0, 4) === "RIFF" &&
        header.toString("ascii", 8, 12) !== "WEBP"
      ) {
        // oxlint-disable-next-line no-await-in-loop -- repair is validated with a complete image decode.
        const repair = await prepareLegacyWebpRepair(
          Buffer.from(await Bun.file(inputPath).arrayBuffer()),
          "analysis"
        );
        if (repair) {
          // oxlint-disable-next-line no-await-in-loop -- conversion must read the validated repaired bytes.
          await Bun.write(inputPath, repair.bytes);
        }
      }
      try {
        // oxlint-disable-next-line no-await-in-loop -- validate each candidate before selecting it.
        await sharp(inputPath, { limitInputPixels: 100_000_000 })
          .autoOrient()
          .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
          .flatten({ background: "white" })
          .toColourspace("srgb")
          .jpeg({ quality: 95 })
          .toFile(outputPath);
      } catch (error) {
        decodeFailures += 1;
        reason =
          error instanceof Error
            ? error.message.slice(0, 240)
            : "Image conversion failed";
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
    throw new AnalysisRasterError(candidates.length, decodeFailures, reason);
  }
  return null;
}
