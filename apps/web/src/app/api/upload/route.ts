import { consumeRateLimit, prisma, scheduleMediaCleanup } from "@asm/db";
import type { MediaType } from "@asm/db";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { imageSize } from "image-size";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient, uploadToAsmob } from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";
import { sniffFileSignature } from "@/lib/utils/magic-bytes";
import { extractVideoThumbnail } from "@/lib/video-thumbnail";

// Hard ceiling accepted from the network before any parsing happens. The
// largest category (video) allows 250MB; multipart framing adds overhead, so
// the request-level cap sits slightly above it. Requests declaring more than
// this are rejected before formData() buffers the body into memory.
const MAX_REQUEST_BYTES = 260 * 1024 * 1024;

// Per-user rolling quota: uploads per day. Generous for real creators
// (dozens of posts with media), hostile to bulk-abuse scripts.
const DAILY_UPLOAD_QUOTA = 120;
const QUOTA_WINDOW_SECONDS = 86_400;

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Shed oversized bodies before parsing: reading formData() buffers the
  // whole payload in memory, so an early Content-Length check is the cheapest
  // defense against memory exhaustion.
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_REQUEST_BYTES) {
    return new NextResponse("Payload too large", { status: 413 });
  }

  const rate = await consumeRateLimit({
    bucket: "upload-user",
    identifier: user.id,
    limit: DAILY_UPLOAD_QUOTA,
    windowSeconds: QUOTA_WINDOW_SECONDS,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Daily upload limit reached. Try again tomorrow." },
      {
        headers: { "retry-after": String(rate.retryAfterSeconds) },
        status: 429,
      }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const postId = formData.get("postId") as string | null;
  const purpose = formData.get("purpose") as string | null;

  if (!file) {
    return new NextResponse("No file provided", { status: 400 });
  }

  console.log("Uploading file:", {
    name: file.name,
    postId,
    size: file.size,
    type: file.type,
  });

  // Read the bytes once and share them: the storage upload and the video
  // thumbnail extraction both consume the same buffer, so a large clip never
  // occupies two copies in memory at once.
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  // The declared MIME type is untrusted; verify the leading bytes actually
  // look like the claimed format before storing anything.
  const signature = sniffFileSignature(fileBuffer, file.type);
  if (!signature.ok) {
    return NextResponse.json(
      { error: signature.reason ?? "Unsupported file content" },
      { status: 415 }
    );
  }

  const upload = await uploadToAsmob(file, user.id, fileBuffer);

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
      const thumbnail = await extractVideoThumbnail(
        fileBuffer,
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
      userId: user.id,
      width,
    },
  });

  // Schedule a delayed cleanup in case the upload is never attached to a post
  // (abandoned draft). If the post is created first, submitPost cancels it.
  // Message attachments live inside E2EE ciphertext, so the server can't link
  // them to a post or comment; they're never scheduled for cleanup.
  if (purpose !== "message") {
    try {
      await scheduleMediaCleanup(media.id);
    } catch (error) {
      console.error("Failed to schedule media cleanup:", error);
    }
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
