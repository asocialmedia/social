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
import { workerEnv } from "../env";
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
  techMetadata: unknown;
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
      key: true,
      originalKey: true,
      publishedKey: true,
      status: true,
      techMetadata: true,
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
      // Stream the S3 object directly to disk instead of buffering the whole
      // image through an ArrayBuffer first.
      await Bun.write(rasterLocalPath, getS3().file(rasterKey));
    } catch {
      rasterLocalPath = null;
    }
  }

  let avLocalPath: string | null = null;
  // Download AV bytes only when transcription can actually run: with
  // Whisper disabled the multi-hundred-MB fetch would be pure waste.
  if (
    workerEnv.WHISPER_ENABLED &&
    (media.type === "VIDEO" || media.type === "AUDIO")
  ) {
    const avKey =
      media.publishedKey ??
      media.originalKey ??
      (media.key.length > 0 ? media.key : null);
    if (avKey) {
      avLocalPath = `/tmp/asm-av-${mediaId}-${crypto.randomUUID()}`;
      try {
        // Stream straight to disk; the S3 file is a lazy handle so buffering
        // through arrayBuffer first would double the peak memory for large
        // videos.
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
    techMetadata: media.techMetadata,
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
        let semantics: Record<string, unknown> | null = null;
        try {
          const classification = await classifyMediaConcepts({
            imagePath: rasterLocalPath,
            mediaId: jobData.mediaId,
            ocrText: ocr?.text,
            transcript: transcription?.transcript,
          });
          semanticTags = classification.tags;
          semantics = classification.semantics ?? null;
        } catch (error) {
          mediaLogger.warn(
            { error: String(error) },
            "concept classification failed"
          );
        }

        // Stage 5: Update Media database row — re-read fresh techMetadata to avoid clobbering concurrent updates
        const freshMediaForTech = await prisma.media.findUnique({
          select: { techMetadata: true },
          where: { id: jobData.mediaId },
        });
        const existingTech =
          freshMediaForTech?.techMetadata &&
          typeof freshMediaForTech.techMetadata === "object"
            ? (structuredClone(freshMediaForTech.techMetadata) as Record<
                string,
                unknown
              >)
            : (source.techMetadata && typeof source.techMetadata === "object"
              ? (structuredClone(source.techMetadata) as Record<
                  string,
                  unknown
                >)
              : {});
        const prevTranscription =
          existingTech.transcription &&
          typeof existingTech.transcription === "object"
            ? (existingTech.transcription as Record<string, unknown>)
            : {};
        const prevAttempts =
          typeof prevTranscription.attempts === "number"
            ? prevTranscription.attempts
            : 0;

        const isAudioVideo = source.type === "AUDIO" || source.type === "VIDEO";
        let transcriptionMeta: Record<string, unknown> | null = null;
        if (transcription) {
          transcriptionMeta = {
            attemptedAt: new Date().toISOString(),
            attempts: prevAttempts + 1,
            error: transcription.error ?? null,
            status: transcription.status,
          };
        } else if (isAudioVideo) {
          transcriptionMeta = {
            attemptedAt: new Date().toISOString(),
            attempts: prevAttempts + 1,
            error: "transcription failed or unavailable",
            status: "failed" as const,
          };
        }

        const updatedTechMetadata = {
          ...existingTech,
          ...(transcriptionMeta ? { transcription: transcriptionMeta } : {}),
        };

        await prisma.media.update({
          data: {
            ...(transcription?.captionsKey
              ? { captionsKey: transcription.captionsKey }
              : {}),
            ...(ocr ? { ocrText: ocr.text.length > 0 ? ocr.text : null } : {}),
            ...(verdict ? { safety: structuredClone(verdict) as object } : {}),
            ...(semanticTags.length > 0 ? { semanticTags } : {}),
            ...(semantics
              ? { semantics: structuredClone(semantics) as object }
              : {}),
            techMetadata: updatedTechMetadata,
            ...(transcription?.transcript
              ? { transcript: transcription.transcript }
              : {}),
          },
          where: { id: jobData.mediaId },
        });

        // Stage 5.5: Notify author that closed captions and transcription are ready
        if (transcription?.captionsKey || transcription?.transcript) {
          try {
            const mediaWithOwner = await prisma.media.findUnique({
              select: {
                id: true,
                post: { select: { id: true, isGust: true, userId: true } },
                postId: true,
                type: true,
                userId: true,
              },
              where: { id: jobData.mediaId },
            });

            if (mediaWithOwner) {
              const recipientId =
                mediaWithOwner.post?.userId ?? mediaWithOwner.userId;
              if (recipientId) {
                const {
                  SYSTEM_MODERATION_USER_ID,
                  enqueueNotificationCreated,
                } = await import("@asm/db");

                await prisma.user.upsert({
                  create: {
                    avatarUrl: "/avatars/avatar-placeholder.png",
                    displayName: "Zeph",
                    email: "zeph@asocialmedia.cc",
                    emailVerified: false,
                    id: SYSTEM_MODERATION_USER_ID,
                    role: "user",
                    username: "zeph",
                  },
                  update: {},
                  where: { id: SYSTEM_MODERATION_USER_ID },
                });

                const existingNotification = mediaWithOwner.postId
                  ? await prisma.notification.findFirst({
                      where: {
                        issuerId: SYSTEM_MODERATION_USER_ID,
                        postId: mediaWithOwner.postId,
                        recipientId,
                        type: "TRANSCRIPTION",
                      },
                    })
                  : null;

                if (!existingNotification) {
                  await prisma.notification.create({
                    data: {
                      issuerId: SYSTEM_MODERATION_USER_ID,
                      postId: mediaWithOwner.postId ?? null,
                      recipientId,
                      type: "TRANSCRIPTION",
                    },
                  });
                  await enqueueNotificationCreated(recipientId);
                  mediaLogger.info(
                    { mediaId: jobData.mediaId, recipientId },
                    "transcription completion notification dispatched"
                  );
                }
              }
            }
          } catch (error) {
            mediaLogger.warn(
              { error: String(error), mediaId: jobData.mediaId },
              "failed to dispatch transcription notification"
            );
          }
        }

        // Stage 6: Update Parent Post (Explicit flag & Recommendation Embeddings)
        const media = await prisma.media.findUnique({
          select: { post: { select: { id: true } }, postId: true },
          where: { id: jobData.mediaId },
        });

        if (media?.post) {
          // Concurrent analyze jobs for different attachments of the same
          // post would read the same attachment list and then race their
          // post.update calls, letting the slower job overwrite the faster
          // one's embedding/semanticTags with stale aggregates. The per-post
          // Redis lock serializes Stage 5+6 so each job re-reads attachments
          // AFTER acquiring the lock - reading before it would still observe
          // a stale sibling set. Locks carry a TTL so a crashed worker cannot
          // wedge the post forever; a skipped stage (lock busy or Redis down)
          // only defers the aggregate to the next analyze job, which
          // recomputes it from scratch.
          const postId = media.post.id;
          const postLockKey = `lock:post-aggregate:${postId}`;
          let locked = false;
          try {
            const { redis } = await import("@asm/db");
            locked =
              (await redis.set(
                postLockKey,
                jobData.mediaId,
                "EX",
                300,
                "NX"
              )) === "OK";
          } catch (error) {
            mediaLogger.warn(
              { error: String(error) },
              "post aggregate lock unavailable; aborting Stage 6 until the next analyze job"
            );
          }
          if (!locked) {
            mediaLogger.info(
              { postId },
              "another analyze job holds the post aggregate lock; skipping Stage 6"
            );
            return { outcome: "analyzed" as const };
          }

          try {
            // Re-read the post and every sibling attachment while holding
            // the lock so the aggregate below includes results already
            // written by sibling jobs that finished ahead of this one.
            const post = await prisma.post.findUnique({
              include: {
                attachments: {
                  select: {
                    ocrText: true,
                    semanticTags: true,
                    transcript: true,
                  },
                },
                tags: { select: { name: true } },
              },
              where: { id: postId },
            });
            if (!post) {
              return { outcome: "analyzed" as const };
            }

            const postExplicitContent = verdict?.explicit ? true : undefined;

            // Aggregate all text and tags across the post and all its attachments
            const allTranscripts = (post.attachments ?? [])
              .map((a) => a.transcript)
              .filter(Boolean)
              .join(" ");
            const allOcr = (post.attachments ?? [])
              .map((a) => a.ocrText)
              .filter(Boolean)
              .join(" ");
            const allSemanticTags = [
              ...new Set([
                ...post.tags.map((t) => t.name),
                ...(post.attachments ?? []).flatMap((a) => a.semanticTags),
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
                ...(postExplicitContent === undefined
                  ? {}
                  : { explicitContent: postExplicitContent }),
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
          } finally {
            try {
              const { redis } = await import("@asm/db");
              // Only delete when we still own the lock so an expired lock
              // taken over by another job is not released early. Compare-
              // and-delete via a Lua script keeps the check atomic.
              await redis.eval(
                `if redis.call('get', KEYS[1]) == ARGV[1] then
                   return redis.call('del', KEYS[1])
                 end
                 return 0`,
                1,
                postLockKey,
                jobData.mediaId
              );
            } catch {
              // Lock expiry or Redis hiccup: the TTL cleans up either way.
            }
          }
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
