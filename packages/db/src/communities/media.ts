import { createLogger } from "@asm/logger";
import { and } from "@prisma/orm-postgres/orm-client";

import prisma, { toPrismaDateTime } from "../prisma";
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

export async function purgeSupersededCommunityMedia(
  mediaId: string,
  communityId: string
): Promise<void> {
  const media = await prisma.orm.public.PostMedia.select(
    "commentId",
    "key",
    "originalKey",
    "postId",
    "publishedKey",
    "size",
    "status",
    "thumbnailKey",
    "userId"
  )
    .include("communities", (community) => community.select("id"))
    .include("communitiesCommunities", (community) => community.select("id"))
    .include("users", (user) => user.select("id"))
    .include("usersUsers", (user) => user.select("id"))
    .where({ id: mediaId })
    .first();
  const ownedByThisCommunity =
    media?.communities.some((community) => community.id === communityId) ||
    media?.communitiesCommunities.some(
      (community) => community.id === communityId
    );
  if (
    !media ||
    !ownedByThisCommunity ||
    media.postId ||
    media.commentId ||
    media.users.length > 0 ||
    media.usersUsers.length > 0
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
    const derivatives = await prisma.orm.public.PostMediaDerivatives.select(
      "key"
    )
      .where({ mediaId })
      .all();
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

  await prisma.orm.public.PostMedia.where({ id: mediaId }).delete();
}

export interface CommunityPromotionResult {
  servingKey: string | null;
}

export async function promoteCommunityDerivative(
  mediaId: string,
  kind: "avatar" | "banner"
): Promise<CommunityPromotionResult> {
  const media = await prisma.orm.public.PostMedia.select(
    "publishedKey",
    "_type"
  )
    .include("communities", (community) => community.select("id"))
    .include("communitiesCommunities", (community) => community.select("id"))
    .include("postMediaDerivatives", (derivative) =>
      derivative.select("key", "kind", "mimeType", "width")
    )
    .where({ id: mediaId })
    .first();
  if (!media || media._type !== "IMAGE" || !media.publishedKey) {
    return { servingKey: null };
  }

  const owner =
    kind === "avatar"
      ? media.communities[0]?.id
      : media.communitiesCommunities[0]?.id;
  if (!owner) {
    return { servingKey: null };
  }

  const webpDerivatives = media.postMediaDerivatives.filter(
    (derivative) => derivative.mimeType === "image/webp"
  );
  const preferredKind = kind === "avatar" ? "sm" : "lg";
  const chosen =
    webpDerivatives.find((derivative) => derivative.kind === preferredKind) ??
    [...webpDerivatives].toSorted(
      (a, b) => (b.width ?? 0) - (a.width ?? 0)
    )[0] ??
    media.postMediaDerivatives[0] ??
    null;
  if (!chosen || chosen.key === media.publishedKey) {
    return { servingKey: media.publishedKey };
  }

  const promotedUrl = communityProxyUrl(kind, owner, chosen.key);
  const swap =
    kind === "avatar"
      ? await prisma.orm.public.Communities.where((community) =>
          and(community.avatarMediaId.eq(mediaId), community.id.eq(owner))
        ).updateAndCount({
          avatarKey: chosen.key,
          avatarUrl: promotedUrl,
          updatedAt: toPrismaDateTime(new Date()),
        })
      : await prisma.orm.public.Communities.where((community) =>
          and(community.bannerMediaId.eq(mediaId), community.id.eq(owner))
        ).updateAndCount({
          bannerKey: chosen.key,
          bannerUrl: promotedUrl,
          updatedAt: toPrismaDateTime(new Date()),
        });
  if (swap === 0) {
    return { servingKey: null };
  }

  const stale = media.postMediaDerivatives.filter(
    (derivative) => derivative.key !== chosen.key
  );
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
    await prisma.orm.public.PostMediaDerivatives.where((derivative) =>
      derivative.key.in(stale.map((entry) => entry.key))
    ).deleteAndCount();
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
