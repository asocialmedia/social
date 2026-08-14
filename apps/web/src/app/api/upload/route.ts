import { prisma, scheduleMediaCleanup } from "@asm/db";
import type { MediaType } from "@asm/db";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { imageSize } from "image-size";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient, uploadToAsmob } from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";
import { extractVideoThumbnail } from "@/lib/video-thumbnail";

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const postId = formData.get("postId") as string | null;

  if (!file) {
    return new NextResponse("No file provided", { status: 400 });
  }

  console.log("Uploading file:", {
    name: file.name,
    postId,
    size: file.size,
    type: file.type,
  });

  const upload = await uploadToAsmob(file, user.id);

  let width: number | null = null;
  let height: number | null = null;
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    try {
      const headerBuffer = await file.slice(0, 64 * 1024).arrayBuffer();
      const dimensions = imageSize(new Uint8Array(headerBuffer));
      width = dimensions.width ?? null;
      height = dimensions.height ?? null;
    } catch (error) {
      console.error("Failed to read image dimensions:", error);
    }
  }

  // Grab a thumbnail frame (~2s in) for video uploads and store it alongside
  // the clip so every video preview can show a real poster instead of a black
  // box. Skipped silently when ffmpeg is unavailable or extraction fails.
  let thumbnailKey: string | null = null;
  let thumbnailWidth: number | null = null;
  let thumbnailHeight: number | null = null;
  if (file.type.startsWith("video/")) {
    try {
      const videoBuffer = Buffer.from(await file.arrayBuffer());
      const thumbnail = await extractVideoThumbnail(
        videoBuffer,
        upload.extension
      );
      if (thumbnail) {
        const thumbKey = `${user.id}/thumbs/${Date.now()}-${crypto.randomUUID()}.jpg`;
        await asmobClient.send(
          new PutObjectCommand({
            Body: thumbnail.buffer,
            Bucket: ASMOB_BUCKET,
            CacheControl: "public, max-age=31536000",
            ContentType: "image/jpeg",
            Key: thumbKey,
            Metadata: {
              category: "VIDEO_THUMBNAIL",
              originalName: file.name,
              uploadedAt: new Date().toISOString(),
              userId: user.id,
            },
          })
        );
        thumbnailKey = thumbKey;
        thumbnailWidth = thumbnail.width;
        thumbnailHeight = thumbnail.height;
      }
    } catch (error) {
      console.error("Failed to create video thumbnail:", error);
    }
  }

  const media = await prisma.media.create({
    data: {
      height,
      key: upload.key,
      mimeType: upload.mimeType,
      postId,
      size: upload.size,
      thumbnailHeight,
      thumbnailKey,
      thumbnailWidth,
      type: upload.type as MediaType,
      url: upload.url,
      width,
    },
  });

  // Schedule a delayed cleanup in case the upload is never attached to a post
  // (abandoned draft). If the post is created first, submitPost cancels it.
  try {
    await scheduleMediaCleanup(media.id);
  } catch (error) {
    console.error("Failed to schedule media cleanup:", error);
  }

  return NextResponse.json({
    height,
    key: upload.key,
    mediaId: media.id,
    type: media.type,
    url: upload.url,
    width,
  });
}
