// Re-share attribution helper: bounded phash near-duplicate scan.
// Called from process-* stages after phash is computed, and must be
// idempotent (guarded by reShareChecked) and single-hop.

import { prisma } from "@asm/db";
import { hammingDistanceHex, PHASH_MATCH_DISTANCE } from "@asm/media";

import { workerEnv } from "../env";
import { mediaLogger } from "../log";

const CANDIDATE_TAKE = 200;
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function attributeReshare(
  mediaId: string,
  phash: string | null,
  userId: string | null
): Promise<void> {
  if (!phash || phash.length !== 16) {
    return;
  }
  if (!workerEnv.PHASH_ATTRIBUTION_ENABLED) {
    return;
  }

  // Claim: exactly-one attribution scan per row, via conditional update.
  // Prevents every retry / backfill re-run from re-doing the O(400) scan.
  const claimed = await prisma.media.updateMany({
    data: { reShareChecked: true },
    where: { id: mediaId, reShareChecked: false },
  });
  if (claimed.count === 0) {
    return;
  }

  const since = new Date(Date.now() - LOOKBACK_MS);

  const candidates = await prisma.media.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      duplicateOf: true,
      id: true,
      originalProvenanceId: true,
      phash: true,
      uploaderDisplayName: true,
      userId: true,
    },
    take: CANDIDATE_TAKE,
    where: {
      createdAt: { gte: since },
      id: { not: mediaId },
      phash: { not: null },
    },
  });

  if (candidates.length === 0) {
    return;
  }

  let best: (typeof candidates)[number] | null = null;
  let bestDist = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate.phash) {
      continue;
    }
    const distance = hammingDistanceHex(phash, candidate.phash);
    if (distance === null || distance > PHASH_MATCH_DISTANCE) {
      continue;
    }
    if (
      !best ||
      distance < bestDist ||
      (distance === bestDist && candidate.createdAt < best.createdAt)
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
    prisma.media.findUnique({
      select: {
        generatedAltText: true,
        uploaderDisplayName: true,
        userId: true,
      },
      where: { id: mediaId },
    }),
    prisma.media.findUnique({
      select: { uploaderDisplayName: true },
      where: { id: rootId },
    }),
  ]);

  if (!fresh || !root?.uploaderDisplayName) {
    return;
  }
  if (fresh.generatedAltText) {
    return;
  }
  if (!fresh.uploaderDisplayName) {
    return;
  }

  const alt = `originally from @${root.uploaderDisplayName} reshared via @${fresh.uploaderDisplayName}`;

  await prisma.media.update({
    data: {
      duplicateOf: best.id,
      generatedAltText: alt,
      originalProvenanceId: rootId,
    },
    where: { id: mediaId },
  });

  mediaLogger.info(
    { distance: bestDist, duplicateOf: best.id, mediaId, rootId },
    "re-share attributed via phash"
  );
}
