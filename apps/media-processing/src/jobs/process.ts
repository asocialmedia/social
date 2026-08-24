// Stage 2 orchestrator: generates derivatives per media type, then leaves the
// row READY. Idempotent by construction — derivative keys are deterministic
// and DB inserts use skipDuplicates.

import { prisma } from "@asm/db";
import { isTerminalStatus } from "@asm/media";

import { resolveWorkerMediaLimits } from "../env";
import { withSpan } from "../log";
import { getS3 } from "../s3";
import { processMediaAudio } from "./process-audio";
import { processMediaImage } from "./process-image";
import { processMediaVideo } from "./process-video";

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
      await Bun.write(
        sourcePath,
        new Uint8Array(await getS3().file(media.publishedKey).arrayBuffer())
      );

      try {
        switch (media.type) {
          case "AUDIO": {
            await processMediaAudio({ limits, mediaId: media.id, sourcePath });
            break;
          }
          case "IMAGE": {
            await processMediaImage({
              limits,
              mediaId: media.id,
              publishedKey: media.publishedKey,
              sourcePath,
            });
            break;
          }
          case "VIDEO": {
            await processMediaVideo({ limits, mediaId: media.id, sourcePath });
            break;
          }
          default: {
            // DOCUMENT and unknown types have no processing yet.
            return { outcome: "skipped" as const };
          }
        }
        return { outcome: "processed" as const };
      } finally {
        await Bun.$`rm -f ${sourcePath} ${sourcePath}-*`
          .quiet()
          .catch(() => null);
      }
    },
    { "media.id": jobData.mediaId }
  );
}
