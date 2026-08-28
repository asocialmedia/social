// Stage 3: semantic analysis. Runs on a still-image representative of the
// asset (video poster, audio cover art, or the published original for
// images): the NSFW classifier stores Media.safety and auto-flags the parent
// post's explicitContent, while scene-text OCR extracts readable text into
// Media.ocrText as input for alt-text assist and text-based moderation. Both
// stages are env-gated and degrade independently - either can be absent.

import { prisma } from "@asm/db";
import type { MediaAnalyzeJobData } from "@asm/media";

import { mediaLogger, withSpan } from "../log";
import { extractImageText } from "../ocr";
import { getS3 } from "../s3";
import { classifyImageSafety } from "../safety";

// Only these types ever reach an NSFW run: AUDIO contributes its cover art,
// DOCUMENT bytes are not images and classify only as "neutral" noise.
const ANALYZABLE_TYPES = new Set(["AUDIO", "IMAGE", "VIDEO"]);

interface AnalysisSource {
  /** True when the object is a real raster (poster/thumb/original). */
  isRaster: boolean;
  localPath: string;
  type: "AUDIO" | "DOCUMENT" | "IMAGE" | "VIDEO";
}

async function resolveAnalysisSource(
  mediaId: string
): Promise<AnalysisSource | null> {
  const media = await prisma.media.findUnique({
    select: {
      derivatives: {
        orderBy: { createdAt: "asc" },
        select: { key: true, kind: true },
      },
      publishedKey: true,
      status: true,
      type: true,
    },
    where: { id: mediaId },
  });
  // Only servable rows get analyzed - the same lifecycle gate as serving.
  // READY excludes every terminal state by construction.
  if (!media || media.status !== "READY") {
    return null;
  }
  if (!ANALYZABLE_TYPES.has(media.type)) {
    return null;
  }
  const preferred =
    media.derivatives.find((d) => d.kind === "poster") ??
    media.derivatives.find((d) => d.kind === "cover") ??
    media.derivatives.find((d) => d.kind === "thumb");
  // Last-resort derivative fallback: promoted profile media (avatar/banner)
  // has its published original deleted once a derivative takes over serving,
  // so analysis must accept any committed derivative before the original.
  const key = preferred?.key ?? media.derivatives[0]?.key ?? media.publishedKey;
  if (!key) {
    return null;
  }
  const localPath = `/tmp/asm-analyze-${mediaId}-${crypto.randomUUID()}`;
  // Streamed copy straight from storage; bytes stay out of worker RAM.
  await Bun.write(localPath, getS3().file(key));
  return {
    // A chosen derivative or the IMAGE original's published bytes are raster;
    // a bare audio file without cover art is not - classifyImageSafety on
    // such input would decode nonsense into a meaningless verdict.
    isRaster: Boolean(preferred) || media.type === "IMAGE",
    localPath,
    type: media.type,
  };
}

export function processMediaAnalyze(
  jobData: MediaAnalyzeJobData
): Promise<{ outcome: "analyzed" | "skipped" }> {
  return withSpan(
    "job.media-analyze",
    async () => {
      const source = await resolveAnalysisSource(jobData.mediaId);
      if (!source) {
        return { outcome: "skipped" as const };
      }
      const { localPath } = source;
      try {
        // Sequential on purpose: both stages are CPU-bound ONNX runs and the
        // worker box is small - competing sessions would just trade cache
        // misses for no wall-clock gain.
        //
        // Only real rasters reach the classifier: audio without cover art and
        // any non-image source would decode as garbage pixels and yield a
        // confident-sounding but meaningless NSFW score. The job stays a
        // success (skipped) in that case so retries cannot loop.
        const verdict = source.isRaster
          ? await classifyImageSafety(localPath)
          : null;
        // Text lives in visuals; waveform posters and document pages have
        // nothing worth OCRing today.
        const wantsOcr = source.type === "IMAGE" || source.type === "VIDEO";
        const ocr =
          wantsOcr && source.isRaster
            ? await extractImageText(localPath)
            : null;

        if (!verdict && !ocr) {
          return { outcome: "skipped" as const };
        }
        await prisma.media.update({
          data: {
            // Empty OCR output means "no readable text", stored as null so
            // the column's contract stays "null = nothing extracted".
            ...(ocr ? { ocrText: ocr.text.length > 0 ? ocr.text : null } : {}),
            ...(verdict ? { safety: structuredClone(verdict) as object } : {}),
          },
          where: { id: jobData.mediaId },
        });

        if (ocr?.text) {
          mediaLogger.info(
            {
              chars: ocr.text.length,
              lines: ocr.text.split("\n").length,
              mediaId: jobData.mediaId,
            },
            "scene text extracted"
          );
        }

        // Feed the existing content gate: auto-flag the linked post.
        if (verdict?.explicit) {
          const media = await prisma.media.findUnique({
            select: { postId: true },
            where: { id: jobData.mediaId },
          });
          if (media?.postId) {
            await prisma.post.update({
              data: { explicitContent: true },
              where: { id: media.postId },
            });
          }
        }
        return { outcome: "analyzed" as const };
      } finally {
        await Bun.$`rm -f ${localPath}`.quiet().catch(() => null);
      }
    },
    { "media.id": jobData.mediaId }
  );
}
