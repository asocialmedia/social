// Stage 3: semantic analysis. v1 runs the NSFW classifier on the poster (or
// first derivative for images) when a model is configured, stores the verdict
// on Media.safety, and auto-flags the parent post's explicitContent so the
// existing ExplicitContentGate renders without manual curation.

import { prisma } from "@asm/db";
import type { MediaAnalyzeJobData } from "@asm/media";

import { withSpan } from "../log";
import { getS3 } from "../s3";
import { classifyImageSafety } from "../safety";

async function resolveAnalysisSource(mediaId: string): Promise<string | null> {
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
  return localPath;
}

export function processMediaAnalyze(
  jobData: MediaAnalyzeJobData
): Promise<{ outcome: "analyzed" | "skipped" }> {
  return withSpan(
    "job.media-analyze",
    async () => {
      const sourcePath = await resolveAnalysisSource(jobData.mediaId);
      if (!sourcePath) {
        return { outcome: "skipped" as const };
      }
      try {
        const verdict = await classifyImageSafety(sourcePath);
        if (!verdict) {
          return { outcome: "skipped" as const };
        }
        await prisma.media.update({
          data: { safety: structuredClone(verdict) as object },
          where: { id: jobData.mediaId },
        });

        // Feed the existing content gate: auto-flag the linked post.
        if (verdict.explicit) {
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
        await Bun.$`rm -f ${sourcePath}`.quiet().catch(() => null);
      }
    },
    { "media.id": jobData.mediaId }
  );
}
