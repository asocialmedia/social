// Stage 2 orchestrator: generates derivatives per media type, then leaves the
// row READY. Isolated storage generations keep existing pointers live while
// replacements are encoded and published.

import { enqueueMediaAnalyze, prisma } from "@asm/db";
import { isTerminalStatus, MEDIA_PIPELINE_VERSION } from "@asm/media";

import { resolveWorkerMediaLimits } from "../../env";
import { mediaLogger, withSpan } from "../../log";
import { getS3 } from "../../s3";
import { processMediaAudio } from "./process-audio";
import { processMediaImage } from "./process-image";
import { processMediaVideo } from "./process-video";

// Delete only unreferenced objects from the failed generation. Published
// partial results and earlier generations remain readable during retries.
async function removePartialDerivatives(
  mediaId: string,
  uploadedKeys: string[]
): Promise<void> {
  const s3 = getS3();
  for (const key of uploadedKeys) {
    let referenced;
    try {
      referenced = await prisma.orm.public.PostMediaDerivatives.where({
        key,
      }).first();
    } catch (error) {
      mediaLogger.warn(
        { error: String(error), key },
        "Skipping cleanup because live references could not be checked"
      );
      continue;
    }
    if (referenced) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- bounded sequential deletes
    try {
      await s3.delete(key);
    } catch (error) {
      mediaLogger.warn(
        { error: String(error), key },
        "partial derivative object cleanup failed"
      );
    }
  }
  if (uploadedKeys.length > 0) {
    mediaLogger.info(
      { count: uploadedKeys.length, mediaId },
      "removed partial derivative objects after failure"
    );
  }
}

export function processMedia(jobData: {
  mediaId: string;
}): Promise<{ outcome: "processed" | "skipped" }> {
  return withSpan(
    "job.media-process",
    async () => {
      const limits = resolveWorkerMediaLimits();
      const media = await prisma.orm.public.PostMedia.select(
        "id",
        "publishedKey",
        "status",
        "_type"
      )
        .where({ id: jobData.mediaId })
        .first();

      if (
        !media ||
        isTerminalStatus(media.status) ||
        media.status === "FAILED"
      ) {
        return { outcome: "skipped" as const };
      }

      // Only READY rows (published by the scan stage) are processed.
      if (media.status !== "READY" || !media.publishedKey) {
        return { outcome: "skipped" as const };
      }

      // Local working copy for decoders; bounded disk per job.
      const sourcePath = `/tmp/asm-proc-${media.id}-${crypto.randomUUID()}`;
      await Bun.write(sourcePath, getS3().file(media.publishedKey));

      // Every object the type processors promote this attempt gets recorded
      // here as it lands. A mid-run failure (ffmpeg dies mid-HLS-ladder, S3
      // write rejected) would otherwise strand those partial derivative
      // objects under derived/ forever - no sweep knows about them.
      const uploadedKeys: string[] = [];
      const storageId = `${media.id}/${crypto.randomUUID()}`;

      try {
        switch (media._type) {
          case "AUDIO": {
            await processMediaAudio({
              limits,
              mediaId: media.id,
              sourcePath,
              storageId,
              uploadedKeys,
            });
            break;
          }
          case "IMAGE": {
            await processMediaImage({
              limits,
              mediaId: media.id,
              publishedKey: media.publishedKey,
              sourcePath,
              storageId,
              uploadedKeys,
            });
            break;
          }
          case "VIDEO": {
            await processMediaVideo({
              limits,
              mediaId: media.id,
              sourcePath,
              storageId,
              uploadedKeys,
            });
            break;
          }
          default: {
            // DOCUMENT and unknown types have no processing or semantic
            // analysis today.
            return { outcome: "skipped" as const };
          }
        }

        const completed = await prisma.orm.public.PostMedia.select(
          "techMetadata"
        )
          .where({ id: media.id })
          .first();
        const metadata =
          completed?.techMetadata &&
          typeof completed.techMetadata === "object" &&
          !Array.isArray(completed.techMetadata)
            ? completed.techMetadata
            : {};
        await prisma.orm.public.PostMedia.where({ id: media.id }).update({
          failureCode: null,
          failureDetail: null,
          pipelineVersion: MEDIA_PIPELINE_VERSION,
          techMetadata: {
            ...metadata,
            deliveryVersion: MEDIA_PIPELINE_VERSION,
          },
        });

        // Semantic analysis trails derivative generation: it consumes the
        // poster/cover/first-derivative output. Enqueue is awaited for the
        // same reason the scan stage awaits its process handoff - losing
        // this enqueue silently strands the last pipeline stage forever.
        try {
          await enqueueMediaAnalyze(media.id);
        } catch (error: unknown) {
          mediaLogger.error(
            { error: String(error), mediaId: media.id },
            "analyze enqueue failed"
          );
        }

        return { outcome: "processed" as const };
      } catch (error) {
        // Keep published partial results while the next attempt repairs them.
        await removePartialDerivatives(media.id, uploadedKeys);
        throw error;
      } finally {
        // SourcePath itself plus every sibling artifact the encoders leave
        // behind: `-suffix` variants (poster, HLS dir, cover, peaks) AND
        // `.ext` suffixed transcode outputs (.opus.webm, .m4a, .mp4).
        await Bun.$`rm -rf ${sourcePath} ${sourcePath}-* ${sourcePath}.*`
          .quiet()
          .catch(() => null);
      }
    },
    { "media.id": jobData.mediaId }
  );
}
