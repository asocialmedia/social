// Stage 3: semantic analysis & enrichment.
// Runs asynchronously on published assets without blocking upload or serving.
// Performs:
// 1. NSFW Safety classification (falconsai ONNX model)
// 2. Scene-text OCR (PP-OCRv4 ONNX model)
// 3. Speech-to-Text Whisper transcription & WebVTT closed-caption generation
// 4. Multi-label semantic topic/concept classification
// 5. Post-level aggregation & 384-dimensional vector embedding for recommendations.
//
// All stages degrade independently with try/catch and timeout guards so a failure
// in any one stage never cascades or impacts published post availability.

import { prisma } from "@asm/db";
import type { MediaAnalyzeJobData } from "@asm/media";

import { classifyMediaConcepts } from "../classify";
import { generateTextEmbedding } from "../embedding";
import { mediaLogger, withSpan } from "../log";
import { extractImageText } from "../ocr";
import { getS3 } from "../s3";
import { classifyImageSafety } from "../safety";
import { transcribeMediaAudio } from "../transcribe";

// Only these types ever reach an analysis run
const ANALYZABLE_TYPES = new Set(["AUDIO", "IMAGE", "VIDEO"]);

interface AnalysisSource {
  avLocalPath: string | null;
  isRaster: boolean;
  rasterLocalPath: string | null;
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
      originalKey: true,
      publishedKey: true,
      status: true,
      type: true,
    },
    where: { id: mediaId },
  });

  if (!media || media.status !== "READY") {
    return null;
  }
  if (!ANALYZABLE_TYPES.has(media.type)) {
    return null;
  }

  const preferredRaster =
    media.derivatives.find((d) => d.kind === "poster") ??
    media.derivatives.find((d) => d.kind === "cover") ??
    media.derivatives.find((d) => d.kind === "thumb");

  const rasterKey =
    preferredRaster?.key ??
    (media.type === "IMAGE" ? media.publishedKey : null) ??
    media.derivatives[0]?.key;

  let rasterLocalPath: string | null = null;
  if (rasterKey) {
    rasterLocalPath = `/tmp/asm-raster-${mediaId}-${crypto.randomUUID()}`;
    try {
      await Bun.write(rasterLocalPath, getS3().file(rasterKey));
    } catch {
      rasterLocalPath = null;
    }
  }

  let avLocalPath: string | null = null;
  if (media.type === "VIDEO" || media.type === "AUDIO") {
    const avKey = media.publishedKey ?? media.originalKey;
    if (avKey) {
      avLocalPath = `/tmp/asm-av-${mediaId}-${crypto.randomUUID()}`;
      try {
        await Bun.write(avLocalPath, getS3().file(avKey));
      } catch {
        avLocalPath = null;
      }
    }
  }

  return {
    avLocalPath,
    isRaster: Boolean(preferredRaster) || media.type === "IMAGE",
    rasterLocalPath,
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

      const { avLocalPath, rasterLocalPath } = source;
      try {
        // Stage 1: NSFW Safety classification
        let verdict = null;
        if (source.isRaster && rasterLocalPath) {
          try {
            verdict = await classifyImageSafety(rasterLocalPath);
          } catch (error) {
            mediaLogger.warn(
              { error: String(error) },
              "safety classification failed"
            );
          }
        }

        // Stage 2: Scene-text OCR
        let ocr = null;
        const wantsOcr = source.type === "IMAGE" || source.type === "VIDEO";
        if (wantsOcr && source.isRaster && rasterLocalPath) {
          try {
            ocr = await extractImageText(rasterLocalPath);
          } catch (error) {
            mediaLogger.warn({ error: String(error) }, "OCR extraction failed");
          }
        }

        // Stage 3: Speech-to-text Whisper transcription & WebVTT generation
        let transcription = null;
        if (
          avLocalPath &&
          (source.type === "VIDEO" || source.type === "AUDIO")
        ) {
          try {
            transcription = await transcribeMediaAudio(
              avLocalPath,
              jobData.mediaId
            );
          } catch (error) {
            mediaLogger.warn({ error: String(error) }, "transcription failed");
          }
        }

        // Stage 4: Multi-label concept & topic classification
        let semanticTags: string[] = [];
        try {
          semanticTags = await classifyMediaConcepts({
            imagePath: rasterLocalPath,
            mediaId: jobData.mediaId,
            ocrText: ocr?.text,
            transcript: transcription?.transcript,
          });
        } catch (error) {
          mediaLogger.warn(
            { error: String(error) },
            "concept classification failed"
          );
        }

        // Stage 5: Update Media database row
        await prisma.media.update({
          data: {
            ...captionsUpdate(transcription?.captionsKey),
            ...(ocr ? { ocrText: ocr.text.length > 0 ? ocr.text : null } : {}),
            ...(verdict ? { safety: structuredClone(verdict) as object } : {}),
            ...(semanticTags.length > 0 ? { semanticTags } : {}),
            ...(transcription?.transcript
              ? { transcript: transcription.transcript }
              : {}),
          },
          where: { id: jobData.mediaId },
        });

        // Stage 6: Update Parent Post (Explicit flag & Recommendation Embeddings)
        const media = await prisma.media.findUnique({
          select: {
            post: {
              select: {
                attachments: {
                  select: {
                    ocrText: true,
                    semanticTags: true,
                    transcript: true,
                  },
                },
                content: true,
                id: true,
                tags: { select: { name: true } },
              },
            },
            postId: true,
          },
          where: { id: jobData.mediaId },
        });

        if (media?.post) {
          const { post } = media;
          const explicitContent = verdict?.explicit ? true : undefined;

          // Aggregate all text and tags across the post and all its attachments
          const allTranscripts = post.attachments
            .map((a) => a.transcript)
            .filter(Boolean)
            .join(" ");
          const allOcr = post.attachments
            .map((a) => a.ocrText)
            .filter(Boolean)
            .join(" ");
          const allSemanticTags = [
            ...new Set([
              ...post.tags.map((t) => t.name),
              ...post.attachments.flatMap((a) => a.semanticTags),
              ...semanticTags,
            ]),
          ];

          const combinedText = [
            post.content,
            allTranscripts,
            allOcr,
            allSemanticTags.join(" "),
          ]
            .filter(Boolean)
            .join("\n");

          let embedding: number[] = [];
          try {
            embedding = await generateTextEmbedding(combinedText);
          } catch (error) {
            mediaLogger.warn(
              { error: String(error) },
              "embedding generation failed"
            );
          }

          await prisma.post.update({
            data: {
              ...(explicitContent === undefined ? {} : { explicitContent }),
              ...(embedding.length > 0 ? { embedding } : {}),
              ...(allSemanticTags.length > 0
                ? { semanticTags: allSemanticTags }
                : {}),
            },
            where: { id: post.id },
          });

          mediaLogger.info(
            {
              embeddingDim: embedding.length,
              postId: post.id,
              tagsCount: allSemanticTags.length,
            },
            "post semantic enrichment completed"
          );
        }

        return { outcome: "analyzed" as const };
      } finally {
        if (rasterLocalPath) {
          await Bun.$`rm -f ${rasterLocalPath}`.quiet().catch(() => null);
        }
        if (avLocalPath) {
          await Bun.$`rm -f ${avLocalPath}`.quiet().catch(() => null);
        }
      }
    },
    { "media.id": jobData.mediaId }
  );
}

function captionsUpdate(
  captionsKey: string | null | undefined
): Record<string, string> {
  if (captionsKey) {
    return { captionsKey };
  }
  return {};
}
