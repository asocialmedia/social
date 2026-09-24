import { and } from "@prisma/orm-postgres/orm-client";

import prisma, { toPrismaDateTime } from "../prisma";
import { deleteObject } from "../storage";

export function profileSurfaceVersion(key: string): string {
  const modulus = 4_294_967_296n;
  let hash = 2_166_136_261n;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash + BigInt(key.codePointAt(index) ?? 0)) % modulus;
    hash = (hash * 16_777_216n) % modulus;
  }
  return hash.toString(16).padStart(8, "0");
}

export function profileProxyUrl(
  kind: "avatar" | "banner",
  userId: string,
  servingKey: string
): string {
  return `/api/users/${kind}/${userId}/image?v=${profileSurfaceVersion(servingKey)}`;
}

export async function purgeSupersededProfileMedia(
  mediaId: string,
  userId: string
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
    .include("users", (user) => user.select("id"))
    .include("usersUsers", (user) => user.select("id"))
    .where({ id: mediaId })
    .first();
  if (
    !media ||
    media.postId ||
    media.commentId ||
    media.users ||
    media.usersUsers ||
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

  try {
    const derivatives = await prisma.orm.public.PostMediaDerivatives.select(
      "key"
    )
      .where({ mediaId })
      .all();
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
    const { redis } = await import("../redis");
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

  await prisma.orm.public.PostMedia.where({ id: mediaId }).delete();
}

export interface PromotionResult {
  servingKey: string | null;
}

export async function promoteProfileDerivative(
  mediaId: string,
  kind: "avatar" | "banner"
): Promise<PromotionResult> {
  const media = await prisma.orm.public.PostMedia.select(
    "publishedKey",
    "_type"
  )
    .include("users", (user) => user.select("id"))
    .include("usersUsers", (user) => user.select("id"))
    .include("postMediaDerivatives", (derivative) =>
      derivative.select("key", "kind", "mimeType", "width")
    )
    .where({ id: mediaId })
    .first();
  if (!media || media._type !== "IMAGE" || !media.publishedKey) {
    return { servingKey: null };
  }

  const owner =
    kind === "avatar" ? media.users[0]?.id : media.usersUsers[0]?.id;
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

  const promotedUrl = profileProxyUrl(kind, owner, chosen.key);
  const swap =
    kind === "avatar"
      ? await prisma.orm.public.Users.where((user) =>
          and(user.avatarMediaId.eq(mediaId), user.id.eq(owner))
        ).updateAndCount({
          avatarKey: chosen.key,
          avatarUrl: promotedUrl,
          updatedAt: toPrismaDateTime(new Date()),
        })
      : await prisma.orm.public.Users.where((user) =>
          and(user.bannerMediaId.eq(mediaId), user.id.eq(owner))
        ).updateAndCount({
          bannerKey: chosen.key,
          bannerUrl: promotedUrl,
          updatedAt: toPrismaDateTime(new Date()),
        });
  if (swap === 0) {
    return { servingKey: null };
  }

  if (kind === "avatar") {
    try {
      const { avatarCache } = await import("../../cache/avatar-cache");
      await avatarCache.set(owner, {
        key: chosen.key,
        updatedAt: new Date().toISOString(),
        url: profileProxyUrl("avatar", owner, chosen.key),
      });
    } catch (error) {
      console.error("Failed to refresh avatar cache after promotion:", error);
    }
  }

  const stale = media.postMediaDerivatives.filter(
    (derivative) => derivative.key !== chosen.key
  );
  await Promise.allSettled(
    stale.map((derivative) =>
      deleteObject(derivative.key).catch((error: unknown) => {
        console.error("Failed to delete stale profile derivative:", error);
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
    console.error("Failed to delete promoted profile original:", error);
  }

  return { servingKey: chosen.key };
}
