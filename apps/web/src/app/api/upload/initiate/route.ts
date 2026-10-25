import { and, consumeRateLimit, prisma } from "@asm/db";
import {
  STICKER_CONVERSION_DAILY_LIMIT,
  STICKER_CONVERSION_PER_MINUTE_LIMIT,
  isStickerSupportedMimeType,
  maxStickerInputBytes,
} from "@asm/media";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  createInitiatedUpload,
  UploadPolicyError,
} from "@/lib/media/media-pipeline";

// Initiates a media upload. The browser uploads the bytes directly to object
// storage through the returned presigned PUT URL; this endpoint only performs
// authorization, quota, and policy checks plus the database row creation.
const initiateSchema = z.object({
  // Media id of an AUDIO upload whose track replaces the video's own audio
  // (gust "sound"). Validated server-side in createInitiatedUpload.
  audioOverlayId: z.string().min(1).nullish(),
  // Conversation a message attachment belongs to. Required when purpose is
  // "message" so the row can be bound to the thread and the peer admitted.
  conversationId: z.string().min(1).max(64).nullish(),
  // Natural image dimensions captured client-side; stored so receivers can
  // reserve the bubble box before the bytes arrive (no scroll jump).
  height: z.number().int().positive().max(16_384).nullish(),
  incognitoSessionId: z.uuid().optional(),
  name: z.string().min(1).max(255),
  // Which surface the upload is for. Selects the byte cap (a wallpaper is far
  // tighter than a post image) and whether abandoned-upload cleanup is
  // scheduled. It is deliberately NOT stored on the Media row: ownership comes
  // from the link that follows, never from what the client asked for.
  purpose: z
    .enum([
      "avatar",
      "banner",
      "comment",
      "message",
      "post",
      "sticker",
      "wallpaper",
    ])
    .nullish(),
  // Uppercase hex is accepted but normalized to lowercase so dedup matching
  // (an exact string comparison against stored digests) cannot miss.
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .transform((value) => value.toLowerCase())
    .nullish(),
  size: z.number().int().positive(),
  type: z.string().min(3).max(100),
  viewOnce: z.boolean().optional(),
  width: z.number().int().positive().max(16_384).nullish(),
});

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = initiateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid upload request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    audioOverlayId,
    conversationId,
    incognitoSessionId,
    viewOnce = false,
    height,
    name,
    purpose,
    sha256,
    size,
    type,
    width,
  } = parsed.data;

  if (
    viewOnce &&
    (purpose !== "message" ||
      !conversationId ||
      !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
        type.toLowerCase()
      ))
  ) {
    return Response.json(
      {
        error:
          "View-once attachments must be a single JPEG, PNG, WebP, or AVIF photo in a chat",
      },
      { status: 415 }
    );
  }

  if (purpose === "sticker") {
    if (!isStickerSupportedMimeType(type)) {
      return Response.json(
        { error: "Choose a JPEG, PNG, WebP, or GIF image for your sticker" },
        { status: 415 }
      );
    }
    if (size > maxStickerInputBytes(type)) {
      return Response.json(
        { error: "That image is too large to turn into a sticker" },
        { status: 413 }
      );
    }
    if (conversationId || incognitoSessionId || viewOnce || audioOverlayId) {
      return Response.json(
        { error: "Sticker sources must be uploaded to your private library" },
        { status: 400 }
      );
    }
    const [burst, daily] = await Promise.all([
      consumeRateLimit({
        bucket: "sticker-conversion-minute",
        identifier: user.id,
        limit: STICKER_CONVERSION_PER_MINUTE_LIMIT,
        windowSeconds: 60,
      }),
      consumeRateLimit({
        bucket: "sticker-conversion-day",
        identifier: user.id,
        limit: STICKER_CONVERSION_DAILY_LIMIT,
        windowSeconds: 86_400,
      }),
    ]);
    if (!burst.allowed || !daily.allowed) {
      const retryAfterSeconds = Math.max(
        burst.allowed ? 0 : burst.retryAfterSeconds,
        daily.allowed ? 0 : daily.retryAfterSeconds
      );
      return NextResponse.json(
        { error: "Sticker conversion limit reached. Try again later." },
        { headers: { "Retry-After": String(retryAfterSeconds) }, status: 429 }
      );
    }
    const activeStickerConversions = await prisma.orm.public.PostMedia.where(
      (media) =>
        and(
          media.stickerSource.eq(true),
          media.userId.eq(user.id),
          media.status.in(["SCANNING", "PROCESSING"])
        )
    ).aggregate((aggregate) => ({ count: aggregate.count() }));
    if (activeStickerConversions.count >= 2) {
      return NextResponse.json(
        {
          error: "Two stickers are already being processed. Try again shortly.",
        },
        { status: 429 }
      );
    }
  }

  // Message attachments must be bound to a thread the uploader belongs to;
  // the link is what later admits the peer in the serving route.
  if (purpose === "message") {
    if (!conversationId) {
      return Response.json(
        { error: "Message attachments require a conversation" },
        { status: 400 }
      );
    }
    // `leftAt IS NULL`, not merely "has a membership row". A member who left or
    // was removed keeps their row - that is what lets them read the history they
    // were already part of - so a row check alone waves them through here, and a
    // removed member could keep pushing new bytes at a den that no longer admits
    // them. Nothing downstream can catch it: the upload is owner-readable from the
    // start, and a finalize would bind it to a conversation this account has
    // already lost the right to write to.
    const membership =
      await prisma.orm.public.MessageConversationMembers.select("userId")
        .where((member) =>
          and(
            member.conversationId.eq(conversationId),
            member.userId.eq(user.id),
            member.leftAt.isNull()
          )
        )
        .first();
    if (!membership) {
      return Response.json(
        { error: "You are not a member of this conversation" },
        { status: 403 }
      );
    }
  }

  let lifecycleProtected = false;
  if (purpose === "message" && conversationId) {
    const conversation = await prisma.orm.public.MessageConversations.where({
      id: conversationId,
    }).first();
    const active = await prisma.orm.public.MessageIncognitoSessions.where({
      conversationId,
    })
      .where((s) => s.endedAt.isNull())
      .first();
    const activeId = active?.id ?? null;
    if (
      (incognitoSessionId && incognitoSessionId !== activeId) ||
      (activeId && !incognitoSessionId)
    ) {
      return Response.json(
        {
          error: "Chat mode changed. Reopen the conversation before uploading.",
        },
        { status: 409 }
      );
    }
    lifecycleProtected = Boolean(
      incognitoSessionId || conversation?.retentionSeconds
    );
  } else if (incognitoSessionId) {
    return Response.json(
      { error: "Incognito uploads require a direct message" },
      { status: 400 }
    );
  }
  try {
    const upload = await createInitiatedUpload({
      audioOverlayId: audioOverlayId ?? null,
      declaredMime: type,
      fileName: name,
      fileSize: size,
      height: height ?? null,
      incognitoSessionId,
      messageConversationId:
        purpose === "message" ? (conversationId ?? null) : null,
      messageLifecycleProtected: lifecycleProtected || viewOnce,
      messageViewOnce: viewOnce,
      purpose: purpose ?? null,
      sha256: viewOnce ? null : (sha256 ?? null),
      userId: user.id,
      width: width ?? null,
    });
    return NextResponse.json({
      deduplicated: upload.deduplicated ?? false,
      extension: upload.extension,
      mediaId: upload.mediaId,
      multipartUpload: upload.multipartUpload ?? null,
      status: upload.status ?? "UPLOADING",
      uploadUrl: upload.uploadUrl,
    });
  } catch (error) {
    if (error instanceof UploadPolicyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("Upload initiation failed:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
