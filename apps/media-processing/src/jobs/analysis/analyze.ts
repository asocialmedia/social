// Stage 3: semantic analysis & enrichment.
// Runs asynchronously on published assets without blocking upload or serving.
// Performs:
// 1. Clef Flash safety and topic decisions
// 2. Scene-text OCR (Google Cloud Vision API)
// 3. Gemini speech transcription & WebVTT closed-caption generation
// 4. Multi-label semantic topic/concept classification
// 5. Post-level aggregation & 384-dimensional vector embedding for recommendations.
//
// All stages degrade independently with try/catch and timeout guards so a failure
// in any one stage never cascades or impacts published post availability.

import { createHash } from "node:crypto";

import {
  and,
  prisma,
  patchMediaAnalysisMetadata,
  patchMediaAnalysisStage,
  indexPostEmbedding,
} from "@asm/db";
import type { Models } from "@asm/db";
import type { MediaAnalyzeJobData } from "@asm/media";
import { UnrecoverableError } from "bullmq";

import { ProviderBudgetDeferredError } from "../../analyze/budget/provider-budget";
import { classifyMediaConcepts } from "../../analyze/classification/classify";
import {
  prepareClefImage,
  ClefDeferredError,
} from "../../analyze/classification/clef";
import {
  normalizeVector,
  generateTextEmbedding,
  embeddingModelId,
} from "../../analyze/embedding/embedding";
import { extractImageText } from "../../analyze/extraction/ocr";
import { transcribeMediaAudio } from "../../analyze/extraction/transcribe";
import {
  downloadAnalysisRaster,
  AnalysisRasterError,
} from "../../analyze/sources/raster-source";
import { extractVideoSamples } from "../../analyze/sources/video-samples";
import {
  analysisStageComplete,
  classificationFingerprint,
  mediaEmbeddingComplete,
  transcriptionComplete,
  transcriptionRetryEligible,
  rasterRetryEligible,
  rasterSourceFingerprint,
} from "../../analyze/state/checkpoints";
import { SEMANTIC_CLASSIFICATION_VERSION } from "../../analyze/state/semantic-version";
import { workerEnv } from "../../env";
import { mediaLogger, withSpan } from "../../log";
import { recordMediaMetric } from "../../metrics";
import { getS3 } from "../../s3";

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
  createdAt: string;
  isRaster: boolean;
  ocrText: string | null;
  rasterLocalPath: string | null;
  semanticTags: string[];
  semantics: MediaJson | null;
  safety: MediaJson | null;
  techMetadata: MediaJson | null;
  transcript: string | null;
  type: "AUDIO" | "DOCUMENT" | "IMAGE" | "VIDEO";
}

async function resolveAnalysisSource(
  mediaId: string,
  _semanticRefresh: boolean
): Promise<AnalysisSource | null> {
  const media = await prisma.orm.public.PostMedia.select(
    "key",
    "createdAt",
    "ocrText",
    "originalKey",
    "publishedKey",
    "semanticTags",
    "semantics",
    "safety",
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

  const classificationComplete =
    asMediaJsonObject(media.techMetadata)?.semanticClassificationVersion ===
      SEMANTIC_CLASSIFICATION_VERSION &&
    asMediaJsonObject(media.techMetadata)?.classificationFingerprint ===
      classificationFingerprint(media.ocrText, media.transcript);
  const needsVisual =
    !classificationComplete ||
    (media._type === "VIDEO" &&
      workerEnv.OCR_ENABLED &&
      !media.ocrText &&
      !analysisStageComplete(media.techMetadata, "ocr")) ||
    (workerEnv.MULTIMODAL_EMBEDDING_ENABLED &&
      !mediaEmbeddingComplete(
        media.techMetadata,
        embeddingModelId(),
        media.ocrText,
        media.transcript
      ));
  const needsTranscription =
    !media.transcript &&
    !transcriptionComplete(media.techMetadata) &&
    transcriptionRetryEligible(media.techMetadata) &&
    workerEnv.WHISPER_ENABLED &&
    Boolean(workerEnv.GEMINI_API_KEY);

  const rasterKeys = [
    ...["poster", "cover", "md", "sm", "thumb"].flatMap((kind) =>
      media.postMediaDerivatives
        .filter((item) => item.kind === kind)
        .map((item) => item.key)
    ),
    ...(media._type === "IMAGE"
      ? [media.publishedKey, media.originalKey, media.key].filter(
          (key): key is string => Boolean(key)
        )
      : []),
  ];

  const rasterFingerprint = rasterSourceFingerprint(rasterKeys);
  if (
    media._type === "IMAGE" &&
    !rasterRetryEligible(media.techMetadata, rasterFingerprint)
  ) {
    return null;
  }

  let rasterLocalPath: string | null = null;
  if (
    rasterKeys.length &&
    (needsVisual || !analysisStageComplete(media.techMetadata, "ocr"))
  ) {
    try {
      rasterLocalPath = await downloadAnalysisRaster(
        rasterKeys,
        `/tmp/asm-raster-${mediaId}-${crypto.randomUUID()}.jpg`
      );
    } catch (error) {
      if (media._type === "IMAGE") {
        if (
          error instanceof AnalysisRasterError &&
          error.decodeFailures === error.attempts
        ) {
          await patchMediaAnalysisStage(mediaId, "raster", {
            fingerprint: rasterFingerprint,
            reason: "unsupported-or-corrupt-image",
            retryAt: Date.now() + 24 * 60 * 60_000,
            status: "unavailable",
          });
          throw new UnrecoverableError(
            "All stored image sources failed decoding; analysis waits for a source repair"
          );
        }
        // Missing storage remains retryable; decoding failure never marks the asset safe.
        throw error;
      }
      mediaLogger.warn(
        { error: String(error), mediaId },
        media._type === "VIDEO"
          ? "Poster unavailable; using video samples for analysis"
          : "Cover unavailable; continuing audio analysis"
      );
    }
  }

  let avLocalPath: string | null = null;
  // Download AV bytes only when transcription can actually run: with
  // transcription disabled the multi-hundred-MB fetch would be pure waste.
  if (
    (media._type === "VIDEO" && needsVisual) ||
    ((media._type === "AUDIO" || media._type === "VIDEO") && needsTranscription)
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
        await Bun.file(avLocalPath)
          .delete()
          .catch(() => null);
        if (rasterLocalPath) {
          await Bun.file(rasterLocalPath)
            .delete()
            .catch(() => null);
        }
        throw new ClefDeferredError(
          "Media AV is temporarily unavailable",
          Date.now() + 60_000
        );
      }
    }
  }

  return {
    avLocalPath,
    createdAt: String(media.createdAt),
    isRaster: Boolean(rasterLocalPath) || media._type === "IMAGE",
    ocrText: media.ocrText,
    rasterLocalPath,
    safety: media.safety,
    semanticTags: [...(media.semanticTags ?? [])],
    semantics: media.semantics,
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
      const samplePaths: string[] = [];
      try {
        if (avLocalPath && source.type === "VIDEO") {
          try {
            await extractVideoSamples(avLocalPath, samplePaths);
          } catch (error) {
            if (!rasterLocalPath) {
              throw new ClefDeferredError(
                `Video sampling pending: ${String(error)}`,
                Date.now() + 5 * 60_000
              );
            }
            mediaLogger.warn(
              { error: String(error), mediaId: jobData.mediaId },
              "Video sampling failed; continuing with validated poster"
            );
          }
        }
        // Stage 2: Scene-text OCR. Each paid frame is checkpointed separately.
        let ocr: { text: string; modelVersion: string } | null = null;
        let ocrError: unknown = null;
        const wantsOcr = source.type === "IMAGE" || source.type === "VIDEO";
        const ocrPaths = [rasterLocalPath, ...samplePaths]
          .filter((path): path is string => path !== null)
          .slice(
            0,
            source.type === "VIDEO"
              ? Math.min(4, workerEnv.VIDEO_OCR_FRAMES ?? 1)
              : 1
          );
        if (
          !source.ocrText &&
          !analysisStageComplete(source.techMetadata, "ocr") &&
          wantsOcr &&
          ocrPaths.length
        ) {
          try {
            const results: { text: string; modelVersion: string }[] = [];
            for (const path of ocrPaths) {
              const fingerprint = createHash("sha256")
                .update(await Bun.file(path).bytes())
                .digest("hex")
                .slice(0, 24);
              const stage = `ocrFrame-${fingerprint}`;
              const saved = asMediaJsonObject(
                asMediaJsonObject(source.techMetadata)?.analysisStages
              )?.[stage];
              const cached = asMediaJsonObject(saved);
              if (
                cached?.status === "completed" &&
                typeof cached.text === "string" &&
                typeof cached.model === "string"
              ) {
                results.push({ modelVersion: cached.model, text: cached.text });
                continue;
              }
              const result = await extractImageText(path);
              if (result) {
                await patchMediaAnalysisStage(jobData.mediaId, stage, {
                  model: result.modelVersion,
                  status: "completed",
                  text: result.text,
                  version: 1,
                });
                results.push(result);
              }
            }
            if (results.length === ocrPaths.length) {
              ocr = {
                modelVersion: results[0]?.modelVersion ?? "vision",
                text: [
                  ...new Set(
                    results.flatMap((result) => result.text.split("\n"))
                  ),
                ]
                  .join("\n")
                  .trim(),
              };
              await prisma.orm.public.PostMedia.where({
                id: jobData.mediaId,
              }).update({ ocrText: ocr.text || null });
              await patchMediaAnalysisStage(jobData.mediaId, "ocr", {
                model: ocr.modelVersion,
                status: "completed",
                version: 1,
              });
            }
          } catch (error) {
            ocrError = error;
            if (!(error instanceof ProviderBudgetDeferredError)) {
              mediaLogger.warn(
                { error: String(error), mediaId: jobData.mediaId },
                "OCR extraction pending retry"
              );
            }
          }
        }

        // Stage 3: Gemini speech transcription & WebVTT generation
        let transcription = null;
        let transcriptionError: unknown = null;
        let transcriptionAttempted = false;
        if (
          !source.transcript &&
          !transcriptionComplete(source.techMetadata) &&
          transcriptionRetryEligible(source.techMetadata) &&
          (source.type === "VIDEO" || source.type === "AUDIO")
        ) {
          if (
            workerEnv.WHISPER_ENABLED &&
            Boolean(workerEnv.GEMINI_API_KEY) &&
            avLocalPath
          ) {
            transcriptionAttempted = true;
            try {
              transcription = await transcribeMediaAudio(
                avLocalPath,
                jobData.mediaId
              );
              if (transcription) {
                await prisma.orm.public.PostMedia.where({
                  id: jobData.mediaId,
                }).update({
                  ...(transcription.transcript
                    ? { transcript: transcription.transcript }
                    : {}),
                  ...(transcription.captionsKey
                    ? { captionsKey: transcription.captionsKey }
                    : {}),
                });
                await patchMediaAnalysisStage(
                  jobData.mediaId,
                  "transcription",
                  {
                    status: transcription.status,
                    version: 1,
                  }
                );
              }
            } catch (error) {
              transcriptionError = error;
              mediaLogger.warn(
                { error: String(error) },
                "transcription failed"
              );
            }
          } else if (!workerEnv.WHISPER_ENABLED || !workerEnv.GEMINI_API_KEY) {
            await patchMediaAnalysisStage(jobData.mediaId, "transcription", {
              reason: workerEnv.WHISPER_ENABLED
                ? "missing_gemini_api_key"
                : "whisper_disabled",
              status: "skipped",
              version: 1,
            });
          }
        }

        const ocrTextForClassification = ocr?.text ?? source.ocrText;
        const transcriptForClassification =
          transcription?.transcript ?? source.transcript;

        let embeddingError: unknown = null;
        const visualPaths = samplePaths.length
          ? samplePaths
          : [rasterLocalPath].filter((path): path is string => path !== null);
        if (
          workerEnv.MULTIMODAL_EMBEDDING_ENABLED &&
          !mediaEmbeddingComplete(
            source.techMetadata,
            embeddingModelId(),
            ocrTextForClassification,
            transcriptForClassification
          )
        ) {
          const images = await Promise.all(
            visualPaths.map(async (path) => ({
              data: await prepareClefImage(path),
              mimeType: "image/jpeg" as const,
            }))
          );
          if (images.length) {
            const vector = await generateTextEmbedding(
              [transcriptForClassification, ocrTextForClassification]
                .filter(Boolean)
                .join("\n"),
              images
            ).catch((error: unknown) => {
              embeddingError = error;
              return [];
            });
            if (vector.length) {
              await patchMediaAnalysisStage(jobData.mediaId, "mediaEmbedding", {
                fingerprint: classificationFingerprint(
                  ocrTextForClassification,
                  transcriptForClassification
                ),
                model: embeddingModelId(),
                status: "completed",
                vector,
                version: 1,
              });
            } else if (!embeddingError) {
              embeddingError = new Error("Multimodal embedding pending");
            }
          }
        }

        // Stage 4: Multi-label concept & topic classification
        let semanticTags: string[] = [];
        let semantics: MediaJson | null = null;
        let classificationSucceeded = false;
        const classificationComplete =
          asMediaJsonObject(source.techMetadata)
            ?.semanticClassificationVersion ===
            SEMANTIC_CLASSIFICATION_VERSION &&
          asMediaJsonObject(source.techMetadata)?.classificationFingerprint ===
            classificationFingerprint(
              ocrTextForClassification,
              transcriptForClassification
            );
        const classification = classificationComplete
          ? {
              safety: undefined,
              semantics: asMediaJsonObject(source.semantics) ?? undefined,
              tags: source.semanticTags,
            }
          : await classifyMediaConcepts({
              imagePaths: visualPaths,
              mediaId: jobData.mediaId,
              ocrText: ocrTextForClassification,
              transcript: transcriptForClassification,
            });
        const verdict =
          classification.safety ??
          (asMediaJsonObject(source.safety)?.explicit === true
            ? { explicit: true }
            : undefined);
        semanticTags = classification.tags;
        semantics = isMediaJson(classification.semantics)
          ? classification.semantics
          : null;
        classificationSucceeded = Boolean(classification.semantics);

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
        } else if (
          isAudioVideo &&
          (!workerEnv.WHISPER_ENABLED || !workerEnv.GEMINI_API_KEY) &&
          !source.transcript &&
          !transcriptionComplete(source.techMetadata)
        ) {
          transcriptionMeta = {
            attemptedAt: new Date().toISOString(),
            attempts: prevAttempts + 1,
            error: workerEnv.WHISPER_ENABLED
              ? "missing_gemini_api_key"
              : "whisper_disabled",
            status: "skipped" as const,
          };
        } else if (
          isAudioVideo &&
          transcriptionAttempted &&
          !(transcriptionError instanceof ProviderBudgetDeferredError) &&
          !source.transcript &&
          !transcriptionComplete(source.techMetadata)
        ) {
          transcriptionMeta = {
            attemptedAt: new Date().toISOString(),
            attempts: prevAttempts + 1,
            error: "transcription failed or unavailable",
            status: "failed" as const,
          };
        }

        const updatedTechMetadata = {
          ...(transcriptionMeta ? { transcription: transcriptionMeta } : {}),
          ...(classificationSucceeded
            ? {
                classificationFingerprint: classificationFingerprint(
                  ocrTextForClassification,
                  transcriptForClassification
                ),
                semanticClassificationVersion: SEMANTIC_CLASSIFICATION_VERSION,
              }
            : {}),
        };
        const effectiveSemanticTags = classificationSucceeded
          ? semanticTags
          : source.semanticTags;

        await prisma.orm.public.PostMedia.where({ id: jobData.mediaId }).update(
          {
            ...(transcription?.captionsKey
              ? { captionsKey: transcription.captionsKey }
              : {}),
            ...(ocr ? { ocrText: ocr.text.length > 0 ? ocr.text : null } : {}),
            ...(verdict && isMediaJson(verdict)
              ? { safety: structuredClone(verdict) }
              : {}),
            ...(classificationSucceeded
              ? { semanticTags: effectiveSemanticTags }
              : {}),
            ...(semantics ? { semantics: structuredClone(semantics) } : {}),
            ...(transcription?.transcript
              ? { transcript: transcription.transcript }
              : {}),
          }
        );

        await patchMediaAnalysisMetadata(jobData.mediaId, updatedTechMetadata);

        if (classificationSucceeded && !classificationComplete) {
          void recordMediaMetric(
            "upload.labeled",
            Date.now() - new Date(source.createdAt).getTime()
          );
        }

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
            throw new ClefDeferredError(
              "Post aggregation is busy",
              Date.now() + 15_000
            );
          }

          try {
            // Re-read the post and every sibling attachment while holding
            // the lock so the aggregate below includes results already
            // written by sibling jobs that finished ahead of this one.
            const post = await prisma.orm.public.Posts.select(
              "content",
              "id",
              "createdAt",
              "semanticTags"
            )
              .include("postMedias", (attachment) =>
                attachment.select(
                  "id",
                  "ocrText",
                  "semanticTags",
                  "transcript",
                  "techMetadata"
                )
              )
              .include("postToTags", (postTag) =>
                postTag.include("tag", (tag) => tag.select("name"))
              )
              .where({ id: postId })
              .first();
            if (!post) {
              if (ocrError) {
                throw ocrError;
              }
              if (embeddingError) {
                throw embeddingError;
              }
              if (transcriptionError instanceof ProviderBudgetDeferredError) {
                throw transcriptionError;
              }
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
                ...(post.semanticTags ?? []).filter(
                  (tag) => !source.semanticTags.includes(tag)
                ),
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
              if (workerEnv.MULTIMODAL_EMBEDDING_ENABLED && embedding.length) {
                const vectors = [embedding];
                for (const attachment of post.postMedias) {
                  const stages = asMediaJsonObject(
                    asMediaJsonObject(attachment.techMetadata)?.analysisStages
                  );
                  const cached = asMediaJsonObject(stages?.mediaEmbedding);
                  const vector = cached?.vector;
                  if (
                    cached?.model === embeddingModelId() &&
                    Array.isArray(vector) &&
                    vector.length === embedding.length &&
                    vector.every(
                      (v) => typeof v === "number" && Number.isFinite(v)
                    )
                  ) {
                    vectors.push(
                      vector.filter((v): v is number => typeof v === "number")
                    );
                  }
                }
                embedding = normalizeVector(
                  embedding.map(
                    (_, index) =>
                      vectors.reduce(
                        (sum, vector) => sum + (vector[index] ?? 0),
                        0
                      ) / vectors.length
                  )
                );
              }
            } catch (error) {
              embeddingError = error;
              mediaLogger.warn(
                { error: String(error) },
                "embedding generation failed"
              );
            }

            await prisma.orm.public.Posts.where({ id: post.id }).update({
              ...(postExplicitContent === undefined
                ? {}
                : { explicitContent: postExplicitContent }),
              ...(embedding.length > 0
                ? { embedding, embeddingModel: embeddingModelId() }
                : {}),
              semanticTags: allSemanticTags,
            });

            if (embedding.length > 0) {
              await indexPostEmbedding(
                post.id,
                embeddingModelId(),
                embedding,
                Date.now()
              );
            }
            if (
              embedding.length === 0 &&
              combinedText.trim() &&
              workerEnv.EMBEDDING_ENABLED
            ) {
              if (embeddingError) {
                throw embeddingError;
              }
              throw new Error(
                "Gemini embedding pending; published labels and media remain available"
              );
            }
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

        // Retry OCR after saving independent labels/transcription/embeddings.
        if (ocrError) {
          throw ocrError;
        }
        if (embeddingError) {
          throw embeddingError;
        }
        if (transcriptionError instanceof ProviderBudgetDeferredError) {
          throw transcriptionError;
        }
        return { outcome: "analyzed" as const };
      } finally {
        await Promise.all(
          samplePaths.map((path) =>
            Bun.file(path)
              .delete()
              .catch(() => null)
          )
        );
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
