import {
  and,
  enqueuePostAnalyze,
  indexPostEmbedding,
  MEDIA_ANALYZE_QUEUE,
  prisma,
  redis,
} from "@asm/db";
import { Queue } from "bullmq";

import { embeddingModelId } from "../analyze/embedding";
import { workerEnv } from "../env";
import { postAnalysisFingerprint } from "../jobs/analyze-post";

let cursor: string | undefined;

// Reconcile missed enqueues and edits without loading the whole post corpus.
export async function postClassificationSweep(): Promise<{ enqueued: number }> {
  if (
    !workerEnv.BACKFILL_ENABLED ||
    !workerEnv.CLASSIFY_ENABLED ||
    !workerEnv.CLOUDFLARE_API_TOKEN ||
    !workerEnv.CLOUDFLARE_ACCOUNT_ID
  ) {
    return { enqueued: 0 };
  }
  const queue = new Queue(MEDIA_ANALYZE_QUEUE, {
    connection: { maxRetriesPerRequest: null, url: workerEnv.REDIS_URL },
  });
  try {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "prioritized"
    );
    const capacity = Math.max(
      0,
      20 - Object.values(counts).reduce((sum, count) => sum + count, 0)
    );
    if (capacity === 0) {
      return { enqueued: 0 };
    }
    const posts = await prisma.orm.public.Posts.select(
      "id",
      "content",
      "embedding",
      "embeddingModel"
    )
      .where((post) =>
        and(post.moderated.eq(false), ...(cursor ? [post.id.gt(cursor)] : []))
      )
      .orderBy((post) => post.id.asc())
      .limit(20)
      .all();
    let enqueued = 0;
    for (const post of posts) {
      if (enqueued >= Math.min(5, capacity)) {
        break;
      }
      cursor = post.id;
      if (
        (await redis.get(`media:clef:post:${post.id}`)) ===
        postAnalysisFingerprint(post.content)
      ) {
        if (
          post.embeddingModel === embeddingModelId() &&
          post.embedding?.length
        ) {
          await indexPostEmbedding(
            post.id,
            post.embeddingModel,
            [...post.embedding],
            Date.now()
          );
        }
        continue;
      }
      await enqueuePostAnalyze(post.id, { backfill: true });
      enqueued += 1;
    }
    if (posts.length === 0) {
      cursor = undefined;
    }
    return { enqueued };
  } finally {
    await queue.close();
  }
}
