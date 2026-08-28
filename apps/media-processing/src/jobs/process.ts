// Stage 2 orchestrator: generates derivatives per media type, then leaves the
// row READY. Idempotent by construction — derivative keys are deterministic
// and DB inserts use skipDuplicates.

import { enqueueMediaAnalyze, prisma } from "@asm/db";
import { isTerminalStatus } from "@asm/media";

import { resolveWorkerMediaLimits } from "../env";
import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";
import { processMediaAudio } from "./process-audio";
import { processMediaImage } from "./process-image";
import { processMediaVideo } from "./process-video";

// Best-effort rollback of one failed process attempt's partial output:
// removes the storage objects it uploaded before the crash point. A later
// retry (or the derived-heal sweep) rebuilds everything deterministically,
// so over-deletion here is safe by design - while leftover partial bytes
// would 404/500 on the variant route forever.
async function removePartialDerivatives(
  mediaId: string,
  uploadedKeys: string[]
): Promise<void> {
  const s3 = getS3();
  for (const key of uploadedKeys) {
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
      const media = await prisma.media.findUnique({
        select: {
          id: true,
          publishedKey: true,
          status: true,
          type: true,
        },
        where: { id: jobData.mediaId },
      });

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

      try {
        switch (media.type) {
          case "AUDIO": {
            await processMediaAudio({
              limits,
              mediaId: media.id,
              sourcePath,
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
              uploadedKeys,
            });
            break;
          }
          case "VIDEO": {
            await processMediaVideo({
              limits,
              mediaId: media.id,
              sourcePath,
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
        // Roll back this attempt's partial output before propagating.
        // Objects first (best-effort, list order irrelevant), then any
        // derivative rows from a prior run that died between createMany and
        // completion - serving must fall back to the original, never render
        // 500s on deleted bytes.
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
