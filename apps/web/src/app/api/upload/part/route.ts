import { prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createMultipartPartUploadUrl,
  expectedMultipartPartCount,
} from "@/lib/media-pipeline";
import { isValidMultipartPartNumber } from "@/lib/multipart-upload";
import { getSessionFromApi } from "@/lib/session";

const partSchema = z.object({
  mediaId: z.string().min(1).max(64),
  partNumber: z.number().int().positive().max(10_000),
  uploadId: z.string().min(1).max(1024),
});

// Presigns one short-lived upload-part URL at a time. This keeps URLs fresh
// for slow connections and ensures the storage edge only receives 16 MiB PUTs.
export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = partSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid multipart upload request" },
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
  if (!isValidMultipartPartNumber(media.size, parsed.data.partNumber)) {
    return Response.json(
      {
        error: `Part number must be between 1 and ${expectedMultipartPartCount(media.size)}`,
      },
      { status: 400 }
    );
  }

  try {
    const uploadUrl = await createMultipartPartUploadUrl({
      key: media.originalKey,
      partNumber: parsed.data.partNumber,
      uploadId: parsed.data.uploadId,
    });
    return NextResponse.json({ uploadUrl });
  } catch (error) {
    console.error("Multipart part presigning failed:", error);
    return Response.json(
      { error: "Unable to prepare upload part" },
      { status: 500 }
    );
  }
}
