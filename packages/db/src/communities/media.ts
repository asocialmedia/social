// Community avatar / banner media lifecycle. Mirrors the user profile-media
// helpers (packages/db/src/users/profile-media.ts) for a second owner surface:
// link a READY upload, purge the superseded one, and promote the best
// derivative once the process stage commits it. Storage quota follows the same
// single-refund invariant as profile media.

import { createLogger } from "@asm/logger";

import prisma from "../prisma";
import { deleteObject } from "../storage";
import { profileSurfaceVersion } from "../users/profile-media";

const logger = createLogger({ serviceName: "community-media" });

export function communityProxyUrl(
  kind: "avatar" | "banner",
  communityId: string,
  servingKey: string
): string {
  return `/api/communities/${kind}/${communityId}/image?v=${profileSurfaceVersion(servingKey)}`;
}

// Deletes a superseded community image: objects (original + derivatives),
// quota refund, then the row. Skips rows that got linked to a post, comment,
// or either profile surface in the meantime - those belong to another
// lifecycle now.
export async function purgeSupersededCommunityMedia(
  mediaId: string,
  communityId: string
): Promise<void> {
  const media = await prisma.media.findUnique({
    select: {
      avatarOf: { select: { id: true } },
      bannerOf: { select: { id: true } },
      commentId: true,
      communityAvatarOf: { select: { id: true } },
      communityBannerOf: { select: { id: true } },
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
  // Only purge when the row is still owned by THIS community. A re-link to
  // another surface (post, comment, profile, or a different community) aborts
  // the purge so we never delete live media.
  const ownedByThisCommunity =
    media?.communityAvatarOf?.id === communityId ||
    media?.communityBannerOf?.id === communityId;
  if (
    !media ||
    !ownedByThisCommunity ||
    media.postId ||
    media.commentId ||
    media.avatarOf ||
    media.bannerOf
  ) {
    return;
  }

  await Promise.allSettled(
    [media.originalKey, media.publishedKey, media.key, media.thumbnailKey]
      .filter((objectKey): objectKey is string => Boolean(objectKey))
      .map((objectKey) =>
        deleteObject(objectKey).catch((error: unknown) => {
          logger.warn(
            { error: String(error), mediaId },
            "failed to delete superseded community media object"
          );
        })
      )
  );

  try {
    const derivatives = await prisma.mediaDerivative.findMany({
      select: { key: true },
      where: { mediaId },
    });
    await Promise.allSettled(
      derivatives.map((derivative) =>
        deleteObject(derivative.key).catch((error: unknown) => {
          logger.warn(
            { error: String(error), mediaId },
            "failed to delete community media derivative"
          );
        })
      )
    );
  } catch (error) {
    logger.warn(
      { error: String(error), mediaId },
      "failed to list community derivatives"
    );
  }

  try {
    const { redis } = await import("../redis");
    if (
      media.userId &&
      media.size > 0 &&
      !["UPLOADING", "REJECTED", "DELETED"].includes(media.status)
    ) {
      await redis.decrby(`user:storage:${media.userId}`, media.size);
    }
  } catch (error) {
    logger.warn(
      { error: String(error), mediaId },
      "failed to refund community media quota"
    );
  }

  await prisma.media.delete({ where: { id: mediaId } });
}

export interface CommunityPromotionResult {
  servingKey: string | null;
}

// Swaps a linked, static community image from its published original to the
// best committed derivative and deletes the original. Called by the image
// process stage and by the link route as race cover.
export async function promoteCommunityDerivative(
  mediaId: string,
  kind: "avatar" | "banner"
): Promise<CommunityPromotionResult> {
  const media = await prisma.media.findUnique({
    select: {
      communityAvatarOf: { select: { id: true } },
      communityBannerOf: { select: { id: true } },
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

  const owner =
    kind === "avatar"
      ? media.communityAvatarOf?.id
      : media.communityBannerOf?.id;
  if (!owner) {
    return { servingKey: null };
  }

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

  const promotedUrl = communityProxyUrl(kind, owner, chosen.key);
  const swap =
    kind === "avatar"
      ? await prisma.community.updateMany({
          data: { avatarKey: chosen.key, avatarUrl: promotedUrl },
          where: { avatarMediaId: mediaId, id: owner },
        })
      : await prisma.community.updateMany({
          data: { bannerKey: chosen.key, bannerUrl: promotedUrl },
          where: { bannerMediaId: mediaId, id: owner },
        });
  if (swap.count === 0) {
    return { servingKey: null };
  }

  const stale = media.derivatives.filter((d) => d.key !== chosen.key);
  await Promise.allSettled(
    stale.map((derivative) =>
      deleteObject(derivative.key).catch((error: unknown) => {
        logger.warn(
          { error: String(error), mediaId },
          "failed to delete stale community derivative"
        );
      })
    )
  );
  if (stale.length > 0) {
    await prisma.mediaDerivative.deleteMany({
      where: { key: { in: stale.map((d) => d.key) } },
    });
  }

  try {
    await deleteObject(media.publishedKey);
  } catch (error) {
    logger.warn(
      { error: String(error), mediaId },
      "failed to delete promoted community original"
    );
  }

  return { servingKey: chosen.key };
}
