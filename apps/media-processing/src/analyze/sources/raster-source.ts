import sharp from "sharp";

import { getS3 } from "../../s3";
import { prepareLegacyWebpRepair } from "../../transcode/legacy-webp";

export interface RasterSourceFailure {
  candidate: number;
  phase: "download" | "prepare" | "decode";
  code: string;
  status?: number;
}

export function rasterSourceFailure(
  error: unknown,
  candidate: number,
  phase: RasterSourceFailure["phase"]
): RasterSourceFailure {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : null;
  // Never retain provider messages, object keys, URLs, headers or filesystem paths.
  const allowedCodes = [
    "NoSuchKey",
    "NoSuchBucket",
    "AccessDenied",
    "InvalidAccessKeyId",
    "SignatureDoesNotMatch",
    "RequestTimeout",
    "SlowDown",
    "ENOENT",
    "EACCES",
    "ENOSPC",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ERR_S3_MISSING_CREDENTIALS",
    "ERR_S3_INVALID_METHOD",
    "ERR_S3_INVALID_PATH",
    "ERR_S3_INVALID_ENDPOINT",
    "ERR_S3_INVALID_SIGNATURE",
    "ERR_S3_INVALID_SESSION_TOKEN",
  ];
  return {
    candidate,
    code:
      typeof code === "string" && allowedCodes.includes(code)
        ? code
        : "unclassified",
    phase,
    ...(typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? { status }
      : {}),
  };
}

export class AnalysisRasterError extends Error {
  readonly attempts: number;
  readonly decodeFailures: number;
  readonly failures: readonly RasterSourceFailure[];
  constructor(
    attempts: number,
    decodeFailures: number,
    reason?: string,
    failures: readonly RasterSourceFailure[] = []
  ) {
    super(
      `No usable analysis raster (${attempts} sources tried, ${decodeFailures} decode failures)${reason ? `: ${reason}` : ""}`
    );
    this.name = "AnalysisRasterError";
    this.attempts = attempts;
    this.decodeFailures = decodeFailures;
    this.failures = failures;
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
  const failures: RasterSourceFailure[] = [];
  for (const key of candidates) {
    const inputPath = `${outputPath}-input`;
    let phase: RasterSourceFailure["phase"] = "download";
    try {
      // oxlint-disable-next-line no-await-in-loop -- fallback depends on the previous source failing.
      await Bun.write(inputPath, getS3().file(key));
      phase = "prepare";
      // Recognize the exact old RIFF-header defect before asking the decoder to read it.
      // oxlint-disable-next-line no-await-in-loop -- inspect one downloaded candidate at a time.
      const header = Buffer.from(
        await Bun.file(inputPath).slice(0, 12).arrayBuffer()
      );
      if (
        Bun.file(inputPath).size <= 50 * 1024 * 1024 &&
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
        failures.push(
          rasterSourceFailure(error, candidates.indexOf(key), "decode")
        );
        reason =
          error instanceof Error
            ? error.message.slice(0, 240)
            : "Image conversion failed";
        continue;
      }
      return outputPath;
    } catch (error) {
      failures.push(rasterSourceFailure(error, candidates.indexOf(key), phase));
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
    throw new AnalysisRasterError(
      candidates.length,
      decodeFailures,
      reason,
      failures
    );
  }
  return null;
}
