import {
  and,
  consumeRateLimit,
  prisma,
  redis,
  scheduleMediaCleanup,
  toPrismaDateTime,
} from "@asm/db";
import { STICKER_MAX_CANVAS_DIMENSION } from "@asm/media";
import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { MEDIA_LIMITS } from "@/lib/media/media-pipeline";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";
import { stickerOriginMediaId } from "@/lib/media/sticker-library";
import { areBlocked } from "@/lib/messages/server";

const deliverySchema = z.object({
  incognitoSessionId: z.uuid().optional(),
  operationId: z.uuid(),
  stickerId: z.string().min(1).max(128),
});

function copySource(key: string): string {
  return `/${ASMOB_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function deliveryResponse(
  mediaId: string,
  animated: boolean,
  width: number,
  height: number
) {
  return {
    animated,
    height,
    kind: animated ? "gif" : "image",
    mediaId,
    url: `/api/media/${encodeURIComponent(mediaId)}/v/sticker-full.webp`,
    width,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const burst = await consumeRateLimit({
    bucket: "sticker-delivery-user",
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (!burst.allowed) {
    return NextResponse.json(
      { error: "Please wait before sending another sticker" },
      {
        headers: { "Retry-After": String(burst.retryAfterSeconds) },
        status: 429,
      }
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = deliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Sticker delivery details are invalid" },
      { status: 400 }
    );
  }
  const { id: conversationId } = await context.params;
  const conversation = await prisma.orm.public.MessageConversations.select(
    "_type",
    "id",
    "retentionSeconds",
    "retentionVersion"
  )
    .where({ id: conversationId })
    .first();
  if (!conversation || !["DM", "DEN"].includes(conversation._type)) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }
  const [membership, peer] = await Promise.all([
    prisma.orm.public.MessageConversationMembers.select("userId")
      .where((member) =>
        and(
          member.conversationId.eq(conversationId),
          member.leftAt.isNull(),
          member.userId.eq(user.id)
        )
      )
      .first(),
    prisma.orm.public.MessageConversationMembers.select("userId")
      .where((member) =>
        and(
          member.conversationId.eq(conversationId),
          member.leftAt.isNull(),
          member.userId.notIn([user.id])
        )
      )
      .first(),
  ]);
  if (!membership || (conversation._type === "DM" && !peer)) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }
  if (
    conversation._type === "DM" &&
    peer &&
    (await areBlocked(user.id, peer.userId))
  ) {
    return NextResponse.json(
      { error: "Stickers are unavailable in this chat" },
      { status: 403 }
    );
  }

  const activeSession = await prisma.orm.public.MessageIncognitoSessions.where({
    conversationId,
  })
    .where((active) => active.endedAt.isNull())
    .first();
  if (
    (activeSession?.id ?? null) !== (parsed.data.incognitoSessionId ?? null)
  ) {
    return NextResponse.json(
      {
        error:
          "Chat mode changed. Reopen the conversation before sending a sticker.",
      },
      { status: 409 }
    );
  }

  const previousOperation = await prisma.orm.public.PostMedia.select(
    "id",
    "incognitoSessionId",
    "messageConversationId",
    "status"
  )
    .where({ stickerOperationId: parsed.data.operationId, userId: user.id })
    .first();
  if (previousOperation) {
    if (
      previousOperation.messageConversationId !== conversationId ||
      previousOperation.incognitoSessionId !== (activeSession?.id ?? null) ||
      previousOperation.status !== "READY"
    ) {
      return NextResponse.json(
        { error: "Sticker send operation was already used" },
        { status: 409 }
      );
    }
    const saved = await prisma.orm.public.UserStickers.where({
      id: parsed.data.stickerId,
      userId: user.id,
    }).first();
    if (!saved) {
      return NextResponse.json({ error: "Sticker not found" }, { status: 404 });
    }
    await prisma.orm.public.UserStickers.where({ id: saved.id }).update({
      lastUsedAt: toPrismaDateTime(new Date()),
    });
    const delivery = await prisma.orm.public.PostMedia.select("height", "width")
      .where({ id: previousOperation.id })
      .first();
    return NextResponse.json(
      deliveryResponse(
        previousOperation.id,
        saved.animated,
        delivery?.width ?? STICKER_MAX_CANVAS_DIMENSION,
        delivery?.height ?? STICKER_MAX_CANVAS_DIMENSION
      )
    );
  }

  const saved = await prisma.orm.public.UserStickers.where({
    id: parsed.data.stickerId,
    userId: user.id,
  }).first();
  if (!saved) {
    return NextResponse.json({ error: "Sticker not found" }, { status: 404 });
  }
  const canonical = await prisma.orm.public.PostMedia.select(
    "id",
    "messageConversationId",
    "publishedKey",
    "size",
    "status",
    "stickerSource",
    "techMetadata",
    "userId"
  )
    .where({ id: saved.mediaId })
    .first();
  if (
    !canonical ||
    canonical.userId !== user.id ||
    !canonical.stickerSource ||
    canonical.messageConversationId ||
    canonical.status !== "READY"
  ) {
    return NextResponse.json(
      { error: "Sticker is no longer available" },
      { status: 404 }
    );
  }
  const canonicalDerivatives =
    await prisma.orm.public.PostMediaDerivatives.where((derivative) =>
      and(
        derivative.mediaId.eq(canonical.id),
        derivative.kind.eq("sticker"),
        derivative.variant.in(["full", "thumb"])
      )
    ).all();
  const full = canonicalDerivatives.find(
    (derivative) => derivative.variant === "full"
  );
  const thumbnail = canonicalDerivatives.find(
    (derivative) => derivative.variant === "thumb"
  );
  if (
    !canonical.publishedKey ||
    !full ||
    !thumbnail ||
    !full.sizeBytes ||
    !thumbnail.sizeBytes
  ) {
    return NextResponse.json(
      { error: "Sticker is still processing" },
      { status: 409 }
    );
  }
  const fullSizeBytes = full.sizeBytes;
  const thumbnailSizeBytes = thumbnail.sizeBytes;

  try {
    const usedBytes = Number((await redis.get(`user:storage:${user.id}`)) ?? 0);
    if (
      Number.isFinite(usedBytes) &&
      usedBytes + fullSizeBytes + thumbnailSizeBytes >
        MEDIA_LIMITS.maxUserStorageBytes
    ) {
      return NextResponse.json(
        { error: "Storage quota exceeded" },
        { status: 507 }
      );
    }
  } catch {
    // Storage admission falls through during a Redis outage, matching normal uploads.
  }

  const deliveryMediaId = crypto.randomUUID();
  const fullKey = `sticker-deliveries/${user.id}/${deliveryMediaId}/full.webp`;
  const thumbnailKey = `sticker-deliveries/${user.id}/${deliveryMediaId}/thumb.webp`;
  const copiedKeys: string[] = [];
  try {
    for (const [source, target] of [
      [full.key, fullKey],
      [thumbnail.key, thumbnailKey],
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- Track each successful copy before attempting the next so partial failure cleanup knows which keys exist.
      await asmobClient.send(
        new CopyObjectCommand({
          Bucket: ASMOB_BUCKET,
          CopySource: copySource(source),
          Key: target,
        })
      );
      copiedKeys.push(target);
    }
    await prisma.transaction(async (tx) => {
      await tx.orm.public.PostMedia.select("id").create({
        _type: "IMAGE",
        claimedMime: "image/webp",
        detectedMime: "image/webp",
        height: full.height ?? STICKER_MAX_CANVAS_DIMENSION,
        id: deliveryMediaId,
        incognitoSessionId: activeSession?.id ?? null,
        key: fullKey,
        messageConversationId: conversationId,
        messageLifecycleProtected: true,
        mimeType: "image/webp",
        originalName: "sticker.webp",
        publishedKey: fullKey,
        size: fullSizeBytes + thumbnailSizeBytes,
        status: "READY",
        stickerOperationId: parsed.data.operationId,
        stickerSource: false,
        techMetadata: { stickerOriginMediaId: stickerOriginMediaId(canonical) },
        url: "",
        userId: user.id,
        visibility: "PRIVATE",
        width: full.width ?? STICKER_MAX_CANVAS_DIMENSION,
      });
      for (const [variant, source, target] of [
        ["full", full, fullKey],
        ["thumb", thumbnail, thumbnailKey],
      ] as const) {
        // oxlint-disable-next-line no-await-in-loop -- Prisma 8 transaction writes use one connection and must remain ordered.
        await tx.orm.public.PostMediaDerivatives.create({
          durationMs: source.durationMs,
          height: source.height,
          key: target,
          kind: "sticker",
          mediaId: deliveryMediaId,
          mimeType: "image/webp",
          pipelineVersion: source.pipelineVersion,
          sizeBytes: source.sizeBytes,
          variant,
          width: source.width,
        });
      }
      if (!activeSession) {
        await tx.orm.public.UserStickers.where({ id: saved.id }).update({
          lastUsedAt: toPrismaDateTime(new Date()),
        });
      }
    });
  } catch (error) {
    await Promise.all(
      copiedKeys.map((key) =>
        asmobClient.send(
          new DeleteObjectCommand({ Bucket: ASMOB_BUCKET, Key: key })
        )
      )
    );
    const duplicate = await prisma.orm.public.PostMedia.select(
      "id",
      "incognitoSessionId",
      "messageConversationId",
      "status"
    )
      .where({ stickerOperationId: parsed.data.operationId, userId: user.id })
      .first();
    if (
      duplicate?.status === "READY" &&
      duplicate.messageConversationId === conversationId &&
      duplicate.incognitoSessionId === (activeSession?.id ?? null)
    ) {
      return NextResponse.json(
        deliveryResponse(
          duplicate.id,
          saved.animated,
          full.width ?? STICKER_MAX_CANVAS_DIMENSION,
          full.height ?? STICKER_MAX_CANVAS_DIMENSION
        )
      );
    }
    console.error("Sticker delivery preparation failed", error);
    return NextResponse.json(
      { error: "Sticker could not be prepared" },
      { status: 500 }
    );
  }
  try {
    await redis.incrby(
      `user:storage:${user.id}`,
      fullSizeBytes + thumbnailSizeBytes
    );
  } catch {
    // Quota counters reconcile on the next normal media accounting pass.
  }
  try {
    await scheduleMediaCleanup(deliveryMediaId);
  } catch {
    // The cleanup queue can retry through its normal orphan sweep.
  }
  return NextResponse.json(
    deliveryResponse(
      deliveryMediaId,
      saved.animated,
      full.width ?? STICKER_MAX_CANVAS_DIMENSION,
      full.height ?? STICKER_MAX_CANVAS_DIMENSION
    ),
    { status: 201 }
  );
}
