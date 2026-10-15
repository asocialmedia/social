// Re-share attribution helper: bounded phash near-duplicate scan.
// Called from process-* stages after phash is computed, and must be
// idempotent (guarded by reShareChecked) and single-hop.

import { and, fromPrismaDateTime, or, prisma, toPrismaDateTime } from "@asm/db";
import {
  AUDIO_FPRINT_LENGTH,
  AUDIO_FPRINT_MATCH_DISTANCE,
  PHASH_MATCH_DISTANCE,
  hammingDistanceHex,
} from "@asm/media";

import { mediaLogger } from "../log";

const CANDIDATE_TAKE = 200;
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function attributeReshare(
  mediaId: string,
  phash: string | null,
  userId: string | null,
  sourceMediaId?: string
): Promise<void> {
  if (!phash) {
    return;
  }
  if (/^(?:0+|f+)$/i.test(phash)) {
    return;
  }
  // Image/video phash is 16 hex chars; audio fingerprint is 32. Both are
  // handled — length check is deferred to the distance threshold selector
  // so audio re-share attribution works too.

  // Claim: exactly-one attribution scan per row, via conditional update.
  // Prevents every retry / backfill re-run from re-doing the O(400) scan.
  const claimed = await prisma.orm.public.PostMedia.where((media) =>
    and(
      media.id.eq(mediaId),
      or(media.reShareChecked.eq(false), media.originalProvenanceId.isNull())
    )
  ).updateAndCount({ reShareChecked: true });
  if (claimed === 0) {
    return;
  }

  const scanStart = performance.now();
  const since = toPrismaDateTime(new Date(Date.now() - LOOKBACK_MS));

  const candidateQuery = () =>
    prisma.orm.public.PostMedia.select(
      "createdAt",
      "duplicateOf",
      "id",
      "originalProvenanceId",
      "phash",
      "uploaderDisplayName",
      "userId"
    )
      .where((candidate) =>
        and(
          candidate.status.eq("READY"),
          candidate.visibility.eq("PUBLIC"),
          candidate.messageConversationId.isNull(),
          candidate.postId.isNotNull(),
          candidate.id.neq(mediaId),
          candidate.phash.isNotNull()
        )
      )
      .include("post", (post) =>
        post
          .select("moderated")
          .include("community", (community) => community.select("_type"))
      )
      .orderBy((candidate) => candidate.createdAt.desc());

  const exact = await candidateQuery()
    .where((candidate) => candidate.phash.eq(phash))
    .limit(20)
    .all();
  const hinted = sourceMediaId
    ? await candidateQuery().where({ id: sourceMediaId }).limit(1).all()
    : [];
  const recent =
    exact.length === 0
      ? await candidateQuery()
          .where((candidate) => candidate.createdAt.gte(since))
          .limit(CANDIDATE_TAKE)
          .all()
      : [];
  const candidates = [...hinted, ...exact, ...recent];

  if (candidates.length === 0) {
    return;
  }

  let best: (typeof candidates)[number] | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  const isAudioCandidate = phash.length === AUDIO_FPRINT_LENGTH;
  // Audio fingerprints are 128-bit (32 hex chars) vs image 64-bit (16);
  // hammingDistanceHex returns bit distance, so scale audio threshold to bits.
  const matchThresholdBits = isAudioCandidate
    ? AUDIO_FPRINT_MATCH_DISTANCE * 4
    : PHASH_MATCH_DISTANCE;

  for (const candidate of candidates) {
    if (
      !candidate.phash ||
      candidate.post?.moderated ||
      candidate.post?.community?._type === "PRIVATE"
    ) {
      continue;
    }
    // Cross-type (image phash vs audio fingerprint) lengths differ -> distance null -> skip
    const distance = hammingDistanceHex(phash, candidate.phash);
    if (distance === null || distance > matchThresholdBits) {
      continue;
    }
    if (
      !best ||
      distance < bestDist ||
      (distance === bestDist &&
        fromPrismaDateTime(candidate.createdAt).getTime() <
          fromPrismaDateTime(best.createdAt).getTime())
    ) {
      best = candidate;
      bestDist = distance;
    }
  }

  if (!best) {
    return;
  }

  // Don't attribute self-reupload.
  if (best.userId && userId && best.userId === userId) {
    return;
  }

  const rootId = best.originalProvenanceId ?? best.duplicateOf ?? best.id;
  if (rootId === mediaId) {
    return;
  }

  const [fresh, root] = await Promise.all([
    prisma.orm.public.PostMedia.select(
      "generatedAltText",
      "techMetadata",
      "uploaderDisplayName",
      "userId"
    )
      .where({ id: mediaId })
      .first(),
    prisma.orm.public.PostMedia.select(
      "uploaderDisplayName",
      "postId",
      "messageConversationId",
      "visibility",
      "status"
    )
      .include("post", (post) =>
        post
          .select("moderated")
          .include("community", (community) => community.select("_type"))
      )
      .where({ id: rootId })
      .first(),
  ]);

  if (
    !fresh ||
    !root?.uploaderDisplayName ||
    !root.postId ||
    root.messageConversationId ||
    root.visibility !== "PUBLIC" ||
    root.status !== "READY" ||
    root.post?.moderated ||
    root.post?.community?._type === "PRIVATE"
  ) {
    return;
  }
  if (fresh.generatedAltText) {
    return;
  }
  if (!fresh.uploaderDisplayName) {
    return;
  }

  const alt = `originally from @${root.uploaderDisplayName} reshared via @${fresh.uploaderDisplayName}`;

  const metadata =
    fresh.techMetadata &&
    typeof fresh.techMetadata === "object" &&
    !Array.isArray(fresh.techMetadata)
      ? fresh.techMetadata
      : {};
  await prisma.orm.public.PostMedia.where({ id: mediaId }).update({
    duplicateOf: best.id,
    generatedAltText: alt,
    originalProvenanceId: rootId,
    techMetadata: { ...metadata, attributionPublic: true },
  });

  const scanMs = Math.round(performance.now() - scanStart);
  if (scanMs > 500) {
    mediaLogger.warn({ mediaId, scanMs }, "slow re-share scan");
  }
  mediaLogger.info(
    { distance: bestDist, duplicateOf: best.id, mediaId, rootId, scanMs },
    "re-share attributed via phash"
  );
}
