import { prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  completeMultipartStoredUpload,
  expectedMultipartPartCount,
  headStoredObject,
} from "@/lib/media/media-pipeline";

const completeSchema = z.object({
  mediaId: z.string().min(1).max(64),
  parts: z
    .array(
      z.object({
        eTag: z.string().min(1).max(512),
        partNumber: z.number().int().positive().max(10_000),
      })
    )
    .min(1)
    .max(10_000),
  uploadId: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = completeSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid multipart completion request" },
      { status: 400 }
    );
  }

  const media = await prisma.media.findFirst({
    select: { originalKey: true, size: true, status: true },
    where: { id: parsed.data.mediaId, userId: user.id },
  });
  if (!media || !media.originalKey) {
    return Response.json({ error: "Media not found" }, { status: 404 });
  }
  if (media.status !== "UPLOADING") {
    return Response.json(
      { error: "Upload is no longer pending" },
      { status: 409 }
    );
  }

  const expectedPartCount = expectedMultipartPartCount(media.size);
  const partsAreComplete =
    parsed.data.parts.length === expectedPartCount &&
    parsed.data.parts.every((part, index) => part.partNumber === index + 1);
  if (!partsAreComplete) {
    return Response.json(
      { error: "Multipart upload has missing or invalid parts" },
      { status: 400 }
    );
  }

  // An earlier completion can succeed in storage just before a network error.
  // Treat the final object as authoritative so a safe retry remains idempotent.
  const alreadyCompleted = await headStoredObject(media.originalKey);
  if (alreadyCompleted?.contentLength === media.size) {
    return NextResponse.json({ mediaId: parsed.data.mediaId });
  }

  try {
    await completeMultipartStoredUpload({
      key: media.originalKey,
      parts: parsed.data.parts,
      uploadId: parsed.data.uploadId,
    });
    return NextResponse.json({ mediaId: parsed.data.mediaId });
  } catch (error) {
    // CompleteMultipartUpload is not replay-safe at the S3 layer. Probe once
    // after an error in case the object landed but the storage response broke.
    const completed = await headStoredObject(media.originalKey);
    if (completed?.contentLength === media.size) {
      return NextResponse.json({ mediaId: parsed.data.mediaId });
    }
    console.error("Multipart upload completion failed:", error);
    return Response.json(
      { error: "Unable to complete upload" },
      { status: 500 }
    );
  }
}
