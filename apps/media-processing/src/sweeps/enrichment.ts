import {
  and,
  enqueueMediaAnalyze,
  prisma,
  redis,
  getQueue,
  MEDIA_ANALYZE_QUEUE,
} from "@asm/db";

import {
  analysisStageComplete,
  mediaEmbeddingComplete,
  transcriptionComplete,
  transcriptionRetryEligible,
} from "../analyze/checkpoints";
import { embeddingModelId } from "../analyze/embedding";
import { workerEnv } from "../env";

let cursor: string | undefined;

export function missingEnrichmentStages(
  media: {
    type: string;
    metadata: unknown;
    ocrText: string | null;
    transcript: string | null;
    parentNeedsEmbedding: boolean;
  },
  enabledOptions?: {
    embedding: boolean;
    ocr: boolean;
    transcription: boolean;
    multimodal?: boolean;
  }
): string[] {
  const enabled = enabledOptions ?? {
    embedding: workerEnv.EMBEDDING_ENABLED && Boolean(workerEnv.GEMINI_API_KEY),
    multimodal:
      workerEnv.MULTIMODAL_EMBEDDING_ENABLED &&
      Boolean(workerEnv.GEMINI_API_KEY),
    ocr:
      workerEnv.OCR_ENABLED && Boolean(workerEnv.GOOGLE_CLOUD_VISION_API_KEY),
    transcription:
      workerEnv.WHISPER_ENABLED && Boolean(workerEnv.GEMINI_API_KEY),
  };
  const missing: string[] = [];
  if (
    enabled.ocr &&
    ["IMAGE", "VIDEO"].includes(media.type) &&
    !media.ocrText &&
    !analysisStageComplete(media.metadata, "ocr")
  ) {
    missing.push("ocr");
  }
  if (
    enabled.transcription &&
    ["AUDIO", "VIDEO"].includes(media.type) &&
    !media.transcript &&
    !transcriptionComplete(media.metadata) &&
    transcriptionRetryEligible(media.metadata)
  ) {
    missing.push("transcription");
  }
  if (enabled.embedding && media.parentNeedsEmbedding) {
    missing.push("embedding");
  }
  if (
    enabled.embedding &&
    enabled.multimodal &&
    ["IMAGE", "VIDEO"].includes(media.type) &&
    !mediaEmbeddingComplete(
      media.metadata,
      embeddingModelId(),
      media.ocrText,
      media.transcript
    )
  ) {
    missing.push("mediaEmbedding");
  }
  return missing;
}

// Cursor over all READY assets: already classified rows still need missing stages repaired.
export async function enrichmentReconciliationSweep(): Promise<{
  enqueued: number;
}> {
  if (
    !workerEnv.BACKFILL_ENABLED ||
    (!workerEnv.GEMINI_API_KEY && !workerEnv.GOOGLE_CLOUD_VISION_API_KEY)
  ) {
    return { enqueued: 0 };
  }
  const counts = await getQueue(MEDIA_ANALYZE_QUEUE).getJobCounts(
    "waiting",
    "active",
    "delayed",
    "prioritized"
  );
  const capacity = Math.max(
    0,
    Math.min(
      5,
      20 - Object.values(counts).reduce((sum, count) => sum + count, 0)
    )
  );
  if (!capacity) {
    return { enqueued: 0 };
  }
  const rows = await prisma.orm.public.PostMedia.select(
    "id",
    "_type",
    "techMetadata",
    "ocrText",
    "transcript",
    "semanticTags"
  )
    .include("post", (post) =>
      post.select("content", "embedding", "embeddingModel")
    )
    .where((media) =>
      and(
        media.status.eq("READY"),
        media._type.in(["IMAGE", "VIDEO", "AUDIO"]),
        ...(cursor ? [media.id.gt(cursor)] : [])
      )
    )
    .orderBy((media) => media.id.asc())
    .limit(50)
    .all();
  let enqueued = 0;
  for (const row of rows) {
    if (enqueued >= capacity) {
      break;
    }
    cursor = row.id;
    const hasMeaning = Boolean(
      row.post?.content?.trim() ||
      row.ocrText ||
      row.transcript ||
      row.semanticTags?.length
    );
    const missing = missingEnrichmentStages({
      metadata: row.techMetadata,
      ocrText: row.ocrText,
      parentNeedsEmbedding: Boolean(
        row.post &&
        hasMeaning &&
        (row.post.embeddingModel !== embeddingModelId() ||
          !row.post.embedding?.length)
      ),
      transcript: row.transcript,
      type: row._type,
    });
    if (!missing.length) {
      continue;
    }
    const lease = `media:enrichment-reconcile:v1:${row.id}`;
    if (
      (await redis.set(lease, missing.join(","), "EX", 6 * 60 * 60, "NX")) !==
      "OK"
    ) {
      continue;
    }
    try {
      await enqueueMediaAnalyze(row.id, { semanticRefresh: true });
      enqueued += 1;
    } catch (error) {
      await redis.del(lease);
      throw error;
    }
  }
  if (!rows.length) {
    cursor = undefined;
  }
  return { enqueued };
}
