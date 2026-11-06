import { createHash } from "node:crypto";

import { and, consumeRateLimit, prisma, rawQuery, redis } from "@asm/db";
import { readSqlBundle as readExtractedSqlBundle } from "@asm/db/sql-template";
import {
  STICKER_LIBRARY_MAX_BYTES,
  STICKER_LIBRARY_MAX_ITEMS,
} from "@asm/media";
import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { getSessionFromApi } from "@/lib/auth/session";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";
import {
  findStickerLibraryEntry,
  resolveStickerSource,
  stickerMessageSchema,
  stickerOriginMediaId,
} from "@/lib/media/sticker-library";

import extractedSqlSource from "./route.sql" with { type: "text" };

const { extracted: extractedSql } = readExtractedSqlBundle(extractedSqlSource, {
  extracted: ["statement1"],
} as const);

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: userId } = session.user;
  const parsed = stickerMessageSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Choose a sticker message" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const rate = await consumeRateLimit({
    bucket: "sticker-save",
    identifier: userId,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rate.allowed) {
    return Response.json(
      { error: "Please wait before saving another sticker" },
      { status: 429 }
    );
  }

  const source = await resolveStickerSource(input, userId);
  const canSave = async () =>
    Boolean(await resolveStickerSource(input, userId));
  if (!source) {
    return Response.json(
      { error: "Sticker is unavailable or cannot be saved" },
      { status: 404 }
    );
  }
  const owned = await findStickerLibraryEntry(userId, source);
  if (owned) {
    return Response.json({ item: owned, saved: true, stickerId: owned.id });
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
  if (
    !full?.sizeBytes ||
    !thumb?.sizeBytes ||
    full.mimeType !== "image/webp" ||
    thumb.mimeType !== "image/webp"
  ) {
    return Response.json({ error: "Sticker is unavailable" }, { status: 404 });
  }
  const digest = createHash("sha256")
    .update(`saved-sticker:${userId}:${source.id}`)
    .digest("hex");
  const operationId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const existingMedia = await prisma.orm.public.PostMedia.select("id")
    .where({ stickerOperationId: operationId, userId })
    .first();
  if (existingMedia) {
    const saved = await prisma.orm.public.UserStickers.where({
      mediaId: existingMedia.id,
      userId,
    }).first();
    if (saved) {
      return Response.json({
        item: { favorite: saved.favorite, id: saved.id },
        saved: true,
        stickerId: saved.id,
      });
    }
  }
  const mediaId = crypto.randomUUID();
  const byteSize = full.sizeBytes + thumb.sizeBytes;
  const copied: string[] = [];
  let committed = false;
  try {
    for (const variant of [full, thumb]) {
      const key = `stickers/${userId}/${mediaId}/${variant.variant}.webp`;
      // oxlint-disable-next-line no-await-in-loop -- Track each copied object for partial-failure cleanup.
      await asmobClient.send(
        new CopyObjectCommand({
          Bucket: ASMOB_BUCKET,
          CopySource: `/${ASMOB_BUCKET}/${variant.key.split("/").map(encodeURIComponent).join("/")}`,
          Key: key,
        })
      );
      copied.push(key);
    }
    const saved = await prisma.transaction(async (tx) => {
      // Prisma rc.14 has no typed row-lock API; share the upload path's per-user quota lock.
      await rawQuery(
        extractedSql.statement1,
        [userId],
        { id: "pg/text@1" },
        tx
      );
      const ownedInTransaction = await findStickerLibraryEntry(
        userId,
        source,
        tx
      );
      if (ownedInTransaction) {
        return { ...ownedInTransaction, mediaId: source.id };
      }
      const duplicateMedia = await tx.orm.public.PostMedia.select(
        "id",
        "status"
      )
        .where({ stickerOperationId: operationId, userId })
        .first();
      if (duplicateMedia) {
        const duplicate = await tx.orm.public.UserStickers.where({
          mediaId: duplicateMedia.id,
          userId,
        }).first();
        if (duplicate) {
          return duplicate;
        }
        if (duplicateMedia.status !== "READY") {
          throw new Error("Please retry saving this sticker");
        }
      }
      const current = await tx.orm.public.UserStickers.where({
        userId,
      }).aggregate((aggregate) => ({
        bytes: aggregate.sum("byteSize"),
        count: aggregate.count(),
      }));
      if (current.count >= STICKER_LIBRARY_MAX_ITEMS) {
        throw new Error("Your sticker library has reached 1,000 stickers");
      }
      if ((current.bytes ?? 0) + byteSize > STICKER_LIBRARY_MAX_BYTES) {
        throw new Error("Your sticker library has reached its storage limit");
      }
      if (!(await canSave())) {
        throw new Error("Sticker is no longer available");
      }
      if (duplicateMedia) {
        return tx.orm.public.UserStickers.create({
          animated: Boolean(full.durationMs),
          byteSize,
          favorite: false,
          mediaId: duplicateMedia.id,
          name: "Saved sticker",
          userId,
        });
      }
      await tx.orm.public.PostMedia.create({
        _type: "IMAGE",
        claimedMime: "image/webp",
        detectedMime: "image/webp",
        height: full.height,
        id: mediaId,
        key: copied[0],
        mimeType: "image/webp",
        originalName: "sticker.webp",
        publishedKey: copied[0],
        size: byteSize,
        status: "READY",
        stickerOperationId: operationId,
        stickerSource: true,
        techMetadata: { stickerOriginMediaId: stickerOriginMediaId(source) },
        url: "",
        userId,
        visibility: "PRIVATE",
        width: full.width,
      });
      for (const [index, variant] of [full, thumb].entries()) {
        // oxlint-disable-next-line no-await-in-loop -- Writes share a transaction connection.
        await tx.orm.public.PostMediaDerivatives.create({
          durationMs: variant.durationMs,
          height: variant.height,
          key: copied[index],
          kind: "sticker",
          mediaId,
          mimeType: "image/webp",
          pipelineVersion: variant.pipelineVersion,
          sizeBytes: variant.sizeBytes,
          variant: variant.variant,
          width: variant.width,
        });
      }
      return tx.orm.public.UserStickers.create({
        animated: Boolean(full.durationMs),
        byteSize,
        favorite: false,
        mediaId,
        name: "Saved sticker",
        userId,
      });
    });
    committed = saved.mediaId === mediaId;
    if (committed) {
      await redis.incrby(`user:storage:${userId}`, byteSize).catch(() => null);
    }
    return Response.json(
      {
        item: { favorite: saved.favorite, id: saved.id },
        saved: true,
        stickerId: saved.id,
      },
      { status: 201 }
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error &&
          [
            "Please retry saving this sticker",
            "Sticker library is unavailable",
            "Your sticker library has reached 1,000 stickers",
            "Your sticker library has reached its storage limit",
            "Sticker is no longer available",
          ].includes(error.message)
            ? error.message
            : "Sticker could not be saved",
      },
      { status: 409 }
    );
  } finally {
    if (!committed) {
      await Promise.allSettled(
        copied.map((Key) =>
          asmobClient.send(
            new DeleteObjectCommand({ Bucket: ASMOB_BUCKET, Key })
          )
        )
      );
    }
  }
}
