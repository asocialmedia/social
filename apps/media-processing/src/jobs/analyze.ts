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

import { and, prisma } from "@asm/db";
import type { Models } from "@asm/db";
import type { MediaAnalyzeJobData } from "@asm/media";

import { classifyMediaConcepts } from "../analyze/classify";
import { generateTextEmbedding } from "../analyze/embedding";
import { extractImageText } from "../analyze/ocr";
import { SEMANTIC_CLASSIFICATION_VERSION } from "../analyze/semantic-version";
import { transcribeMediaAudio } from "../analyze/transcribe";
import { workerEnv } from "../env";
import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";
import { classifyImageSafety } from "../scan/safety";

// Only these types ever reach an analysis run
const ANALYZABLE_TYPES = new Set(["AUDIO", "IMAGE", "VIDEO"]);
type MediaJson = NonNullable<Models.public_PostMedia["techMetadata"]>;
type MediaJsonObject = Readonly<Record<string, MediaJson>>;

function isMediaJson(value: unknown): value is MediaJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isMediaJson(item));
  }
  if (typeof value === "object") {
    return Object.values(value).every(
      (item) => item !== undefined && isMediaJson(item)
    );
  }
  return false;
}

function isMediaJsonObject(value: unknown): value is MediaJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (item) => item !== undefined && isMediaJson(item)
  );
}

function asMediaJsonObject(value: unknown): MediaJsonObject | null {
  return isMediaJsonObject(value) ? value : null;
}

interface AnalysisSource {
  avLocalPath: string | null;
  isRaster: boolean;
  ocrText: string | null;
  rasterLocalPath: string | null;
  semanticTags: string[];
  techMetadata: MediaJson | null;
  transcript: string | null;
  type: "AUDIO" | "DOCUMENT" | "IMAGE" | "VIDEO";
}

async function resolveAnalysisSource(
  mediaId: string,
  semanticRefresh: boolean
): Promise<AnalysisSource | null> {
  const media = await prisma.orm.public.PostMedia.select(
    "key",
    "ocrText",
    "originalKey",
    "publishedKey",
    "semanticTags",
    "status",
    "techMetadata",
    "transcript",
    "_type"
  )
    .include("postMediaDerivatives", (derivative) =>
      derivative.select("key", "kind").orderBy((item) => item.createdAt.asc())
    )
    .where({ id: mediaId })
    .first();

  if (!media || media.status !== "READY") {
    return null;
  }
  if (!ANALYZABLE_TYPES.has(media._type)) {
    return null;
  }

  const preferredRaster =
    media.postMediaDerivatives.find((d) => d.kind === "poster") ??
    media.postMediaDerivatives.find((d) => d.kind === "cover") ??
    media.postMediaDerivatives.find((d) => d.kind === "thumb");

  const rasterKey =
    preferredRaster?.key ??
    (media._type === "IMAGE" ? media.publishedKey : null) ??
    media.postMediaDerivatives[0]?.key;

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
    !semanticRefresh &&
    workerEnv.WHISPER_ENABLED &&
    (media._type === "VIDEO" || media._type === "AUDIO")
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
    isRaster: Boolean(preferredRaster) || media._type === "IMAGE",
    ocrText: media.ocrText,
    rasterLocalPath,
    semanticTags: [...(media.semanticTags ?? [])],
    techMetadata: media.techMetadata,
    transcript: media.transcript,
    type: media._type,
  };
}

export function processMediaAnalyze(
  jobData: MediaAnalyzeJobData
): Promise<{ outcome: "analyzed" | "skipped" }> {
  return withSpan(
    "job.media-analyze",
    async () => {
      const semanticRefresh = jobData.semanticRefresh === true;
      const source = await resolveAnalysisSource(
        jobData.mediaId,
        semanticRefresh
      );
      if (!source) {
        return { outcome: "skipped" as const };
      }

      const { avLocalPath, rasterLocalPath } = source;
      try {
        // Stage 1: NSFW Safety classification
        let verdict = null;
        if (!semanticRefresh && source.isRaster && rasterLocalPath) {
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
        if (
          !semanticRefresh &&
          wantsOcr &&
          source.isRaster &&
          rasterLocalPath
        ) {
          try {
            ocr = await extractImageText(rasterLocalPath);
          } catch (error) {
            mediaLogger.warn({ error: String(error) }, "OCR extraction failed");
          }
        }

        // Stage 3: Speech-to-text Whisper transcription & WebVTT generation
        let transcription = null;
        if (
          !semanticRefresh &&
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

        const ocrTextForClassification = semanticRefresh
          ? source.ocrText
          : ocr?.text;
        const transcriptForClassification = semanticRefresh
          ? source.transcript
          : transcription?.transcript;

        // Stage 4: Multi-label concept & topic classification
        let semanticTags: string[] = [];
        let semantics: MediaJson | null = null;
        let classificationSucceeded = false;
        try {
          const classification = await classifyMediaConcepts({
            imagePath: rasterLocalPath,
            mediaId: jobData.mediaId,
            ocrText: ocrTextForClassification,
            transcript: transcriptForClassification,
          });
          semanticTags = classification.tags;
          semantics = isMediaJson(classification.semantics)
            ? classification.semantics
            : null;
          classificationSucceeded = true;
        } catch (error) {
          mediaLogger.warn(
            { error: String(error) },
            "concept classification failed"
          );
        }

        // Stage 5: Update Media database row — re-read fresh techMetadata to avoid clobbering concurrent updates
        const freshMediaForTech = await prisma.orm.public.PostMedia.select(
          "techMetadata"
        )
          .where({ id: jobData.mediaId })
          .first();
        const freshTech = asMediaJsonObject(freshMediaForTech?.techMetadata);
        const sourceTech = asMediaJsonObject(source.techMetadata);
        const existingTech: MediaJsonObject = structuredClone(
          freshTech ?? sourceTech ?? {}
        );
        const storedTranscription = asMediaJsonObject(
          existingTech.transcription
        );
        const prevTranscription = storedTranscription ?? {};
        const prevAttempts =
          typeof prevTranscription.attempts === "number"
            ? prevTranscription.attempts
            : 0;

        const isAudioVideo = source.type === "AUDIO" || source.type === "VIDEO";
        let transcriptionMeta: MediaJsonObject | null = null;
        if (transcription) {
          transcriptionMeta = {
            attemptedAt: new Date().toISOString(),
            attempts: prevAttempts + 1,
            ...(transcription.error ? { error: transcription.error } : {}),
            status: transcription.status,
          };
        } else if (isAudioVideo && !semanticRefresh) {
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
          ...(classificationSucceeded
            ? {
                semanticClassificationVersion: SEMANTIC_CLASSIFICATION_VERSION,
              }
            : {}),
        };
        const effectiveSemanticTags =
          semanticRefresh && semanticTags.length === 0
            ? source.semanticTags
            : semanticTags;

        await prisma.orm.public.PostMedia.where({ id: jobData.mediaId }).update(
          {
            ...(transcription?.captionsKey
              ? { captionsKey: transcription.captionsKey }
              : {}),
            ...(ocr ? { ocrText: ocr.text.length > 0 ? ocr.text : null } : {}),
            ...(verdict && isMediaJson(verdict)
              ? { safety: structuredClone(verdict) }
              : {}),
            ...(effectiveSemanticTags.length > 0
              ? { semanticTags: effectiveSemanticTags }
              : {}),
            ...(semantics ? { semantics: structuredClone(semantics) } : {}),
            techMetadata: updatedTechMetadata,
            ...(transcription?.transcript
              ? { transcript: transcription.transcript }
              : {}),
          }
        );

        // Stage 5.5: Notify author that closed captions and transcription are ready
        if (transcription?.captionsKey || transcription?.transcript) {
          try {
            const mediaWithOwner = await prisma.orm.public.PostMedia.select(
              "id",
              "postId",
              "_type",
              "userId"
            )
              .include("post", (post) => post.select("id", "isGust", "userId"))
              .where({ id: jobData.mediaId })
              .first();

            if (mediaWithOwner) {
              const recipientId =
                mediaWithOwner.post?.userId ?? mediaWithOwner.userId;
              if (recipientId) {
                const {
                  SYSTEM_MODERATION_USER_ID,
                  enqueueNotificationCreated,
                } = await import("@asm/db");

                const transcriptionNotificationId = await prisma.transaction(
                  async (transaction) => {
                    await transaction.orm.public.Users.upsert({
                      conflictOn: { id: SYSTEM_MODERATION_USER_ID },
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
                    });

                    const existingNotification = mediaWithOwner.postId
                      ? await transaction.orm.public.Notifications.where(
                          (notification) =>
                            and(
                              notification.issuerId.eq(
                                SYSTEM_MODERATION_USER_ID
                              ),
                              notification.postId.eq(mediaWithOwner.postId),
                              notification.recipientId.eq(recipientId),
                              notification._type.eq("TRANSCRIPTION")
                            )
                        ).first()
                      : null;
                    if (existingNotification) {
                      return null;
                    }

                    const notification =
                      await transaction.orm.public.Notifications.create({
                        _type: "TRANSCRIPTION",
                        issuerId: SYSTEM_MODERATION_USER_ID,
                        postId: mediaWithOwner.postId,
                        recipientId,
                      });
                    return notification.id;
                  }
                );

                if (transcriptionNotificationId) {
                  await enqueueNotificationCreated(
                    recipientId,
                    transcriptionNotificationId
                  );
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
        const media = await prisma.orm.public.PostMedia.select("postId")
          .include("post", (post) => post.select("id"))
          .where({ id: jobData.mediaId })
          .first();

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
            const post = await prisma.orm.public.Posts.select("content", "id")
              .include("postMedias", (attachment) =>
                attachment.select("id", "ocrText", "semanticTags", "transcript")
              )
              .include("postToTags", (postTag) =>
                postTag.include("tag", (tag) => tag.select("name"))
              )
              .where({ id: postId })
              .first();
            if (!post) {
              return { outcome: "analyzed" as const };
            }

            const postExplicitContent = verdict?.explicit ? true : undefined;

            // Aggregate all text and tags across the post and all its attachments
            const allTranscripts = post.postMedias
              .map((attachment) => attachment.transcript)
              .filter(Boolean)
              .join(" ");
            const allOcr = post.postMedias
              .map((attachment) => attachment.ocrText)
              .filter(Boolean)
              .join(" ");
            const allSemanticTags = [
              ...new Set([
                ...post.postToTags.flatMap((postTag) =>
                  postTag.tag ? [postTag.tag.name] : []
                ),
                ...post.postMedias
                  .filter((attachment) => attachment.id !== jobData.mediaId)
                  .flatMap((attachment) => attachment.semanticTags ?? []),
                ...effectiveSemanticTags,
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

            await prisma.orm.public.Posts.where({ id: post.id }).update({
              ...(postExplicitContent === undefined
                ? {}
                : { explicitContent: postExplicitContent }),
              ...(embedding.length > 0 ? { embedding } : {}),
              ...(allSemanticTags.length > 0
                ? { semanticTags: allSemanticTags }
                : {}),
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
