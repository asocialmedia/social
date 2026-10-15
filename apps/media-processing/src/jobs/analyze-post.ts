import { createHash } from "node:crypto";

import { and, generateLocalEmbedding, prisma, redis } from "@asm/db";

import {
  clefSafetyVerdict,
  CLEF_POLICY_VERSION,
  ClefDeferredError,
  evaluateClef,
} from "../analyze/clef";
import { generateTextEmbedding } from "../analyze/embedding";
import { workerEnv } from "../env";

export function postAnalysisFingerprint(content: string): string {
  return createHash("sha256")
    .update(CLEF_POLICY_VERSION)
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
    if ((await redis.get(markerKey)) === fingerprint) {
      return;
    }
    if (!post.content.trim()) {
      await redis.set(markerKey, fingerprint, "EX", 30 * 24 * 60 * 60);
      return;
    }
    const decision = await evaluateClef({ text: post.content });
    const tags = [
      ...new Set([
        ...decision.tags,
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
    const embedding = await generateTextEmbedding(text);
    // A user edit during inference wins. A fresh queued job will evaluate it.
    const updated = await prisma.orm.public.Posts.where((item) =>
      and(item.id.eq(postId), item.content.eq(post.content))
    ).updateAndCount({
      ...(clefSafetyVerdict(decision).explicit
        ? { explicitContent: true }
        : {}),
      ...(embedding.length
        ? { embedding }
        : { embedding: generateLocalEmbedding(text) }),
      semanticTags: tags,
    });
    if (updated > 0) {
      await redis.set(markerKey, fingerprint, "EX", 30 * 24 * 60 * 60);
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
