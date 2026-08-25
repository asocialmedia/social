import { NextResponse } from "next/server";
import { z } from "zod";

import { createInitiatedUpload, UploadPolicyError } from "@/lib/media-pipeline";
import { getSessionFromApi } from "@/lib/session";

// Initiates a media upload. The browser uploads the bytes directly to object
// storage through the returned presigned PUT URL; this endpoint only performs
// authorization, quota, and policy checks plus the database row creation.
const initiateSchema = z.object({
  name: z.string().min(1).max(255),
  purpose: z.enum(["avatar", "comment", "message", "post"]).nullish(),
  size: z.number().int().positive(),
  type: z.string().min(3).max(100),
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

  const { name, purpose, size, type } = parsed.data;

  try {
    const upload = await createInitiatedUpload({
      declaredMime: type,
      fileName: name,
      fileSize: size,
      purpose: purpose ?? null,
      userId: user.id,
    });
    return NextResponse.json({
      extension: upload.extension,
      mediaId: upload.mediaId,
      status: "UPLOADING",
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
