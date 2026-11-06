import { and, prisma, redis, scheduleMediaCleanup } from "@asm/db";
import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { stickerOriginMediaId } from "@/lib/media/sticker-library";

import { ASMOB_BUCKET, asmobClient } from "./object-storage";

export async function prepareCommunitySticker({
  userId,
  stickerId,
  operationId,
  roomId,
}: {
  userId: string;
  stickerId: string;
  operationId: string;
  roomId: string;
}) {
  const previous = await prisma.orm.public.PostMedia.where({
    stickerOperationId: operationId,
    userId,
  }).first();
  if (previous) {
    const metadata = previous.techMetadata;
    if (
      metadata &&
      typeof metadata === "object" &&
      "communityRoomId" in metadata &&
      metadata.communityRoomId === roomId &&
      previous.status === "READY"
    ) {
      return previous.id;
    }
    throw new Error("Sticker operation was already used");
  }
  const saved = await prisma.orm.public.UserStickers.where({
    id: stickerId,
    userId,
  }).first();
  if (!saved) {
    throw new Error("Sticker not found");
  }
  const source = await prisma.orm.public.PostMedia.where({
    id: saved.mediaId,
    status: "READY",
    stickerSource: true,
    userId,
  }).first();
  if (!source) {
    throw new Error("Sticker is unavailable");
  }
  const variants = await prisma.orm.public.PostMediaDerivatives.where((row) =>
    and(
      row.mediaId.eq(source.id),
      row.kind.eq("sticker"),
      row.variant.in(["full", "thumb"])
    )
  ).all();
  const full = variants.find((variant) => variant.variant === "full");
  const thumb = variants.find((variant) => variant.variant === "thumb");
  if (!full?.sizeBytes || !thumb?.sizeBytes) {
    throw new Error("Sticker is still processing");
  }
  const size = full.sizeBytes + thumb.sizeBytes;
  const id = crypto.randomUUID();
  const copied: string[] = [];
  try {
    for (const variant of [full, thumb]) {
      const key = `community-stickers/${userId}/${id}/${variant.variant}.webp`;
      // oxlint-disable-next-line no-await-in-loop -- Track partial copies for cleanup.
      await asmobClient.send(
        new CopyObjectCommand({
          Bucket: ASMOB_BUCKET,
          CopySource: `/${ASMOB_BUCKET}/${variant.key.split("/").map(encodeURIComponent).join("/")}`,
          Key: key,
        })
      );
      copied.push(key);
    }
    await prisma.transaction(async (tx) => {
      await tx.orm.public.PostMedia.create({
        _type: "IMAGE",
        height: full.height,
        id,
        key: copied[0],
        mimeType: "image/webp",
        originalName: "sticker.webp",
        publishedKey: copied[0],
        size,
        status: "READY",
        stickerOperationId: operationId,
        techMetadata: {
          animated: saved.animated,
          communityRoomId: roomId,
          stickerOriginMediaId: stickerOriginMediaId(source),
        },
        url: "",
        userId,
        visibility: "PRIVATE",
        width: full.width,
      });
      for (const [index, variant] of [full, thumb].entries()) {
        // oxlint-disable-next-line no-await-in-loop -- Transaction writes are ordered.
        await tx.orm.public.PostMediaDerivatives.create({
          durationMs: variant.durationMs,
          height: variant.height,
          key: copied[index],
          kind: "sticker",
          mediaId: id,
          mimeType: "image/webp",
          pipelineVersion: variant.pipelineVersion,
          sizeBytes: variant.sizeBytes,
          variant: variant.variant,
          width: variant.width,
        });
      }
    });
  } catch (error) {
    await Promise.allSettled(
      copied.map((Key) =>
        asmobClient.send(new DeleteObjectCommand({ Bucket: ASMOB_BUCKET, Key }))
      )
    );
    const duplicate = await prisma.orm.public.PostMedia.where({
      stickerOperationId: operationId,
      userId,
    }).first();
    const metadata = duplicate?.techMetadata;
    if (
      duplicate?.status === "READY" &&
      metadata &&
      typeof metadata === "object" &&
      "communityRoomId" in metadata &&
      metadata.communityRoomId === roomId
    ) {
      return duplicate.id;
    }
    throw error;
  }
  await redis.incrby(`user:storage:${userId}`, size).catch(() => null);
  await scheduleMediaCleanup(id).catch(() => {
    /* empty */
  });
  return id;
}
