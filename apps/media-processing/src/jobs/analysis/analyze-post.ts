import { createHash } from "node:crypto";

import {
  and,
  prisma,
  redis,
  indexPostEmbedding,
  recordSharedTopicRelations,
} from "@asm/db";

import {
  clefSafetyVerdict,
  CLEF_POLICY_VERSION,
  ClefDeferredError,
  evaluateClef,
} from "../../analyze/classification/clef";
import { EmbeddingDeferredError } from "../../analyze/embedding/deferred";
import {
  generateTextEmbedding,
  embeddingModelId,
} from "../../analyze/embedding/embedding";
import { embeddingInputFingerprint } from "../../analyze/embedding/fingerprint";
import { SEMANTIC_CLASSIFICATION_VERSION } from "../../analyze/state/semantic-version";
import { workerEnv } from "../../env";

export function postAnalysisFingerprint(content: string): string {
  return createHash("sha256")
    .update(CLEF_POLICY_VERSION)
    .update(SEMANTIC_CLASSIFICATION_VERSION)
    .update(embeddingModelId())
    .update(content)
    .digest("hex");
}

export async function processPostAnalyze({
  postId,
}: {
  postId: string;
}): Promise<void> {
  if (!workerEnv.CLASSIFY_ENABLED) {
    return;
  }
  const lockKey = `lock:post-aggregate:${postId}`;
  const owner = crypto.randomUUID();
  if ((await redis.set(lockKey, owner, "EX", 300, "NX")) !== "OK") {
    throw new ClefDeferredError(
      "Post aggregation is busy",
      Date.now() + 15_000
    );
  }
  try {
    const post = await prisma.orm.public.Posts.select(
      "id",
      "embeddingModel",
      "embeddingFingerprint",
      "embedding",
      "content",
      "moderated",
      "semanticTags"
    )
      .include("postMedias", (media) =>
        media.select("semanticTags", "ocrText", "transcript")
      )
      .include("postToTags", (postTag) =>
        postTag.include("tag", (tag) => tag.select("name"))
      )
      .where({ id: postId })
      .first();
    if (!post || post.moderated) {
      return;
    }
    const fingerprint = postAnalysisFingerprint(post.content);
    const markerKey = `media:clef:post:${postId}`;
    const complete = (await redis.get(markerKey)) === fingerprint;
    if (!post.content.trim() && !post.postMedias.length) {
      await redis.set(markerKey, fingerprint, "EX", 30 * 24 * 60 * 60);
      return;
    }
    let classificationError: unknown = null;
    let decision: Awaited<ReturnType<typeof evaluateClef>> | null = null;
    if (post.content.trim() && !complete) {
      try {
        decision = await evaluateClef({ text: post.content });
      } catch (error) {
        classificationError = error;
      }
    }
    const tags = [
      ...new Set([
        ...(complete || classificationError ? (post.semanticTags ?? []) : []),
        ...(decision?.tags ?? []),
        ...post.postToTags.flatMap((item) =>
          item.tag ? [item.tag.name.toLowerCase()] : []
        ),
        ...post.postMedias.flatMap((media) => media.semanticTags ?? []),
      ]),
    ];
    const text = [
      post.content,
      tags.join(" "),
      ...post.postMedias.flatMap((media) => [media.ocrText, media.transcript]),
    ]
      .filter(Boolean)
      .join("\n");
    await recordSharedTopicRelations(tags, `post:${postId}`);
    const embeddingFingerprint = embeddingInputFingerprint(
      embeddingModelId(),
      text
    );
    const reuseEmbedding =
      post.embeddingFingerprint === embeddingFingerprint &&
      post.embeddingModel === embeddingModelId() &&
      Boolean(post.embedding?.length);
    let embeddingError: unknown = null;
    const embedding = reuseEmbedding
      ? [...(post.embedding ?? [])]
      : await generateTextEmbedding(text).catch((error: unknown) => {
          embeddingError = error;
          return [];
        });
    // A user edit during inference wins. A fresh queued job will evaluate it.
    const updated = await prisma.orm.public.Posts.where((item) =>
      and(item.id.eq(postId), item.content.eq(post.content))
    ).updateAndCount({
      ...(decision && clefSafetyVerdict(decision).explicit
        ? { explicitContent: true }
        : {}),
      ...(embedding.length
        ? {
            embedding,
            embeddingFingerprint,
            embeddingModel: embeddingModelId(),
          }
        : {}),
      semanticTags: tags,
    });
    if (updated > 0 && embedding.length) {
      await indexPostEmbedding(
        postId,
        embeddingModelId(),
        embedding,
        Date.now()
      );
    }
    // Classification is complete independently of embedding availability.
    if (updated > 0 && !classificationError) {
      await redis.set(markerKey, fingerprint, "EX", 30 * 24 * 60 * 60);
    }
    if (
      updated > 0 &&
      !embedding.length &&
      text.trim() &&
      workerEnv.EMBEDDING_ENABLED
    ) {
      if (embeddingError) {
        throw embeddingError;
      }
      throw new EmbeddingDeferredError("unavailable", Date.now() + 15 * 60_000);
    }
    if (updated > 0 && classificationError) {
      throw classificationError;
    }
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      1,
      lockKey,
      owner
    );
  }
}
