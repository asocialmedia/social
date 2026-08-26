// Stage 3: semantic analysis. Runs on the poster (or first derivative for
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

interface AnalysisSource {
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
      type: true,
    },
    where: { id: mediaId },
  });
  if (!media) {
    return null;
  }
  const preferred =
    media.derivatives.find((d) => d.kind === "poster") ??
    media.derivatives.find((d) => d.kind === "thumb") ??
    media.derivatives[0];
  const key = preferred?.key ?? media.publishedKey;
  if (!key) {
    return null;
  }
  const localPath = `/tmp/asm-analyze-${mediaId}-${crypto.randomUUID()}`;
  await Bun.write(
    localPath,
    new Uint8Array(await getS3().file(key).arrayBuffer())
  );
  return { localPath, type: media.type };
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
        const verdict = await classifyImageSafety(localPath);
        // Text lives in visuals; waveform posters and document pages have
        // nothing worth OCRing today.
        const wantsOcr = source.type === "IMAGE" || source.type === "VIDEO";
        const ocr = wantsOcr ? await extractImageText(localPath) : null;

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
