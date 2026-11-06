// Lifecycle erasure storage deletion. Removes bytes for a PostMedia row already marked
// DELETED with CHAT_LIFECYCLE_ERASURE, keeping the row so reads stay denied while retries
// remain possible. Throws on storage failure so BullMQ retries; the row is the retryable
// metadata and is never removed here.
import { prisma } from "@asm/db";
import type { MediaDeleteCascadeJobData } from "@asm/media";

import { mediaLogger, withSpan } from "../log";
import { getS3 } from "../s3";

export async function processMediaDeleteCascade(
  jobData: MediaDeleteCascadeJobData
): Promise<void> {
  const { mediaId } = jobData;
  await withSpan(
    "job.media-delete-cascade",
    async () => {
      const media = await prisma.orm.public.PostMedia.select(
        "id",
        "key",
        "originalKey",
        "publishedKey",
        "thumbnailKey",
        "customThumbnailKey",
        "captionsKey",
        "status",
        "failureCode"
      )
        .include("postMediaDerivatives", (d) => d.select("key"))
        .where({ id: mediaId })
        .first();
      // Only lifecycle-erased rows are handled here; anything else is a no-op so a
      // misrouted job cannot delete live bytes.
      if (
        !media ||
        media.status !== "DELETED" ||
        media.failureCode !== "CHAT_LIFECYCLE_ERASURE"
      ) {
        return;
      }
      const keys: string[] = [];
      for (const key of [
        media.originalKey,
        media.publishedKey,
        media.key,
        media.thumbnailKey,
        media.customThumbnailKey,
        media.captionsKey,
      ]) {
        if (key) {
          keys.push(key);
        }
      }
      for (const derivative of media.postMediaDerivatives ?? []) {
        if (derivative.key) {
          keys.push(derivative.key);
        }
      }
      // Sequential best-effort ordering is deliberate: S3 deletes are idempotent and a
      // failure throws below to retry the whole set rather than leaving a partial erasure
      // silently marked complete.
      const s3 = getS3();
      // HLS records point at the master playlist; erase its unlisted segments too.
      for (const key of new Set(
        keys.filter((candidate) => candidate.endsWith(".m3u8"))
      )) {
        if (!key.startsWith("derived/") || !key.includes(`/${mediaId}/`)) {
          throw new Error("Invalid lifecycle media prefix");
        }
        const prefix = key.slice(0, key.lastIndexOf("/") + 1);
        let continuationToken: string | undefined;
        do {
          const page = await s3.list({
            continuationToken,
            maxKeys: 1000,
            prefix,
          });
          for (const object of page.contents ?? []) {
            if (object.key) {
              await s3.file(object.key).delete();
            }
          }
          continuationToken = page.nextContinuationToken;
        } while (continuationToken);
      }
      for (const key of new Set(keys)) {
        // Throws on failure so the job retries with the row intact.
        // oxlint-disable-next-line no-await-in-loop -- deliberate ordering, see above
        await s3.file(key).delete();
      }
      await prisma.orm.public.PostMedia.where({
        failureCode: "CHAT_LIFECYCLE_ERASURE",
        id: mediaId,
        status: "DELETED",
      }).update({
        aiProvenance: null,
        altText: null,
        blurDataUrl: null,
        failureCode: "CHAT_LIFECYCLE_ERASED",
        failureDetail: null,
        generatedAltText: null,
        ocrText: null,
        originalName: null,
        phash: null,
        safety: null,
        semanticTags: null,
        semantics: null,
        sha256: null,
        techMetadata: null,
        transcript: null,
      });
      mediaLogger.info({ mediaId }, "lifecycle media bytes deleted");
    },
    { "media.id": mediaId }
  );
}
