import { enqueueMediaScan, prisma } from "@asm/db";
import { maxBytesForType } from "@asm/media";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  headStoredObject,
  MEDIA_LIMITS,
  UploadPolicyError,
} from "@/lib/media-pipeline";
import { getSessionFromApi } from "@/lib/session";

// Completes a presigned direct upload. Verifies the object actually landed in
// quarantine, enforces the declared size against reality, moves the row into
// the QUARANTINED state and hands off to the scanning pipeline.
const finalizeSchema = z.object({
  mediaId: z.string().min(1).max(64),
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
  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { mediaId } = parsed.data;

  const media = await prisma.media.findUnique({
    select: {
      id: true,
      originalKey: true,
      size: true,
      type: true,
      userId: true,
    },
    where: { id: mediaId },
  });
  if (!media || media.userId !== user.id) {
    // Deliberately opaque: do not reveal existence of other users' rows.
    return Response.json({ error: "Media not found" }, { status: 404 });
  }
  if (!media.originalKey) {
    return Response.json(
      { error: "Upload was not initiated" },
      { status: 409 }
    );
  }

  try {
    const stored = await headStoredObject(media.originalKey);
    if (!stored) {
      return Response.json(
        { error: "Upload not found in storage. Retry the upload." },
        { status: 409 }
      );
    }

    const maxBytes = maxBytesForType(MEDIA_LIMITS, media.type);
    let policyError: UploadPolicyError | null = null;
    if (stored.contentLength <= 0) {
      policyError = new UploadPolicyError("Uploaded file is empty", 400);
    } else if (stored.contentLength > maxBytes) {
      policyError = new UploadPolicyError(
        `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`,
        413
      );
    }
    if (policyError) {
      // Mark rejected from UPLOADING directly — the old catch-block only
      // matched QUARANTINED and was therefore dead code (the +1 check throws
      // before the flip). Refund is not needed here: quota is only charged
      // after a successful flip.
      await prisma.media.updateMany({
        data: {
          failureCode: "limit-exceeded",
          rejectedReason: policyError.status === 400 ? "CORRUPT" : "TOO_LARGE",
          status: "REJECTED",
        },
        where: { id: mediaId, status: "UPLOADING", userId: user.id },
      });
      return Response.json(
        { error: policyError.message },
        { status: policyError.status }
      );
    }

    // Conditional transition makes double-finalize races harmless: the loser
    // of the UPDATE affects zero rows and reports the current state.
    const transition = await prisma.media.updateMany({
      data: { size: stored.contentLength, status: "QUARANTINED" },
      where: { id: mediaId, status: "UPLOADING", userId: user.id },
    });
    if (transition.count === 0) {
      const current = await prisma.media.findUnique({
        select: { status: true },
        where: { id: mediaId },
      });
      return NextResponse.json({ mediaId, status: current?.status });
    }

    // Charge the storage quota counter now that bytes are real.
    try {
      const { redis } = await import("@asm/db");
      await redis.incrby(`user:storage:${user.id}`, stored.contentLength);
    } catch (error) {
      console.error("Failed to update storage quota counter:", error);
    }

    await enqueueMediaScan(mediaId);

    return NextResponse.json({ mediaId, status: "QUARANTINED" });
  } catch (error) {
    console.error("Upload finalization failed:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
