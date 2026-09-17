import { prisma } from "@asm/db";
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
  name: z.string().min(1).max(255),
  purpose: z.enum(["avatar", "banner", "comment", "message", "post"]).nullish(),
  // Uppercase hex is accepted but normalized to lowercase so dedup matching
  // (an exact string comparison against stored digests) cannot miss.
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .transform((value) => value.toLowerCase())
    .nullish(),
  size: z.number().int().positive(),
  type: z.string().min(3).max(100),
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
    height,
    name,
    purpose,
    sha256,
    size,
    type,
    width,
  } = parsed.data;

  // Message attachments must be bound to a thread the uploader belongs to;
  // the link is what later admits the peer in the serving route.
  if (purpose === "message") {
    if (!conversationId) {
      return Response.json(
        { error: "Message attachments require a conversation" },
        { status: 400 }
      );
    }
    const membership = await prisma.messageConversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: user.id },
      },
    });
    if (!membership) {
      return Response.json(
        { error: "You are not a member of this conversation" },
        { status: 403 }
      );
    }
  }

  try {
    const upload = await createInitiatedUpload({
      audioOverlayId: audioOverlayId ?? null,
      declaredMime: type,
      fileName: name,
      fileSize: size,
      height: height ?? null,
      messageConversationId:
        purpose === "message" ? (conversationId ?? null) : null,
      purpose: purpose ?? null,
      sha256: sha256 ?? null,
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
