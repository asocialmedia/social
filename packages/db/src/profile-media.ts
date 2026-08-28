// Shared lifecycle helpers for media linked to a user profile (avatar /
// banner). Two operations:
//
//  - purgeSupersededProfileMedia: a replacement upload nukes the old one —
//    objects (original + derivatives), quota refund, then the row. Skips rows
//    that got linked to a post/comment/profile surface in the meantime, which
//    closes the re-link race documented in the link routes.
//
//  - promoteProfileDerivative: profile images are linked while serving the
//    published original (GIF-safe, works before derivatives exist). Once the
//    process stage commits derivatives, static images swap their serving key
//    to the best derivative and the original is deleted — long-term storage
//    keeps only the optimized bytes. Animated GIFs skip the swap: motion
//    lives only in the original (derivatives are static frames).
//
// Storage quota follows the single-refund invariant: media.size is refunded
// exactly once, at purge/reap — never at promotion.

import prisma from "./prisma";
import { deleteObject } from "./storage";

// Purges a superseded profile media row: objects (original + derivatives),
// quota refund, then the row itself. Skips rows that got linked to a post,
// comment, or profile surface in the meantime — those belong to the pipeline
// lifecycle now. The user's link was already cleared/moved before this runs,
// so a re-link in between would have set a different mediaId; purge only
// proceeds when the media is still owned by this user.
export async function purgeSupersededProfileMedia(
  mediaId: string,
  userId: string
): Promise<void> {
  const media = await prisma.media.findUnique({
    select: {
      avatarOf: { select: { id: true } },
      bannerOf: { select: { id: true } },
      commentId: true,
      key: true,
      originalKey: true,
      postId: true,
      publishedKey: true,
      size: true,
      status: true,
      thumbnailKey: true,
      userId: true,
    },
    where: { id: mediaId },
  });
  if (
    !media ||
    media.postId ||
    media.commentId ||
    media.avatarOf ||
    media.bannerOf ||
    media.userId !== userId
  ) {
    return;
  }

  await Promise.allSettled(
    [media.originalKey, media.publishedKey, media.key, media.thumbnailKey]
      .filter((objectKey): objectKey is string => Boolean(objectKey))
      .map((objectKey) =>
        deleteObject(objectKey).catch((error: unknown) => {
          console.error(
            "Failed to delete superseded profile media object:",
            error
          );
        })
      )
  );

  // Derivatives live under their own keys; collect them before deleting the
  // row. Best-effort: a missed derivative gets caught by the maintenance
  // sweep eventually or simply orphans harmlessly.
  try {
    const derivatives = await prisma.mediaDerivative.findMany({
      select: { key: true },
      where: { mediaId },
    });
    await Promise.allSettled(
      derivatives.map((derivative) =>
        deleteObject(derivative.key).catch((error: unknown) => {
          console.error("Failed to delete profile media derivative:", error);
        })
      )
    );
  } catch (error) {
    console.error("Failed to list profile media derivatives:", error);
  }

  try {
    const { redis } = await import("./redis");
    if (
      media.userId &&
      media.size > 0 &&
      !["UPLOADING", "REJECTED", "DELETED"].includes(media.status)
    ) {
      await redis.decrby(`user:storage:${media.userId}`, media.size);
    }
  } catch (error) {
    console.error("Failed to refund storage quota:", error);
  }

  await prisma.media.delete({ where: { id: mediaId } });
}

export interface PromotionResult {
  /** Serving key now backing the profile surface (or still the original). */
  servingKey: string | null;
}

// Swaps a linked, static profile image from its published original to the
// best committed derivative and deletes the original. Call sites:
//  - the image process stage, right after derivative commit
//  - the link routes, right after linking (covers the race where derivatives
//    committed before the user linked the media)
//
// Safety properties:
//  - only acts when the media is still the linked avatar/banner of its owner
//    (conditional updateMany — never clobbers a newer upload's pointer)
//  - animated sources are skipped (the original is the animated artifact)
//  - no derivatives → no-op (codec-failure fallback keeps the original)
//  - every delete is best-effort; failure leaves consistent serving state
export async function promoteProfileDerivative(
  mediaId: string,
  kind: "avatar" | "banner"
): Promise<PromotionResult> {
  const media = await prisma.media.findUnique({
    select: {
      avatarOf: { select: { id: true } },
      bannerOf: { select: { id: true } },
      derivatives: {
        select: { key: true, kind: true, mimeType: true, width: true },
      },
      publishedKey: true,
      type: true,
    },
    where: { id: mediaId },
  });
  if (!media || media.type !== "IMAGE" || !media.publishedKey) {
    return { servingKey: null };
  }

  const owner = kind === "avatar" ? media.avatarOf?.id : media.bannerOf?.id;
  if (!owner) {
    return { servingKey: null };
  }

  // Preferred rung: avatar renders at 640px (sm), banner at 1200px (lg).
  // Fall back to the widest webp rung, then any committed derivative — small
  // sources produce fewer rungs, and any derivative beats the raw original.
  const webpDerivatives = media.derivatives.filter(
    (d) => d.mimeType === "image/webp"
  );
  const preferredKind = kind === "avatar" ? "sm" : "lg";
  const chosen =
    webpDerivatives.find((d) => d.kind === preferredKind) ??
    [...webpDerivatives].toSorted(
      (a, b) => (b.width ?? 0) - (a.width ?? 0)
    )[0] ??
    media.derivatives[0] ??
    null;
  if (!chosen || chosen.key === media.publishedKey) {
    return { servingKey: media.publishedKey };
  }

  // Conditional pointer swap: if the user has since linked different media,
  // updateMany matches nothing and promotion aborts.
  const swap =
    kind === "avatar"
      ? await prisma.user.updateMany({
          data: { avatarKey: chosen.key },
          where: { avatarMediaId: mediaId, id: owner },
        })
      : await prisma.user.updateMany({
          data: { bannerKey: chosen.key },
          where: { bannerMediaId: mediaId, id: owner },
        });
  if (swap.count === 0) {
    return { servingKey: null };
  }

  if (kind === "avatar") {
    try {
      const { avatarCache } = await import("../cache/avatar-cache");
      await avatarCache.set(owner, {
        key: chosen.key,
        updatedAt: new Date().toISOString(),
        url: `/api/users/avatar/${owner}/image`,
      });
    } catch (error) {
      // Cache self-heals via TTL (1h) if this fails.
      console.error("Failed to refresh avatar cache after promotion:", error);
    }
  }

  // Delete the non-chosen derivatives (objects + rows) — only the optimized
  // serving derivative stays.
  const stale = media.derivatives.filter((d) => d.key !== chosen.key);
  await Promise.allSettled(
    stale.map((derivative) =>
      deleteObject(derivative.key).catch((error: unknown) => {
        console.error("Failed to delete stale profile derivative:", error);
      })
    )
  );
  if (stale.length > 0) {
    await prisma.mediaDerivative.deleteMany({
      where: { key: { in: stale.map((d) => d.key) } },
    });
  }

  // Delete the published original. The row keeps its publishedKey column:
  // the retention/GC sweeps key off it, and purge uses it as a delete hint.
  try {
    await deleteObject(media.publishedKey);
  } catch (error) {
    console.error("Failed to delete promoted profile original:", error);
  }

  return { servingKey: chosen.key };
}
