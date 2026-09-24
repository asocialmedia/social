import { canViewCommunity, prisma } from "@asm/db";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";
import { ASMOB_BUCKET, asmobClient } from "@/lib/media/object-storage";

const IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

function inferMimeFromKey(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": {
      return "image/png";
    }
    case "jpg":
    case "jpeg": {
      return "image/jpeg";
    }
    case "webp": {
      return "image/webp";
    }
    case "gif": {
      return "image/gif";
    }
    case "svg": {
      return "image/svg+xml";
    }
    case "avif": {
      return "image/avif";
    }
    case "heic": {
      return "image/heic";
    }
    default: {
      return null;
    }
  }
}

// Community avatars live in the private ASMOB bucket and are streamed through
// this app route so content is only reachable via the app, never directly from
// object storage. Mirrors the user avatar proxy.
export async function GET(
  _request: Request,
  context: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await context.params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const community = await prisma.orm.public.Communities.select(
    "avatarKey",
    "id",
    "_type"
  )
    .where({ id: communityId })
    .first();
  if (!community?.avatarKey) {
    return new NextResponse("Avatar not found", { status: 404 });
  }
  const { avatarKey } = community;

  // A PRIVATE community's avatar is part of its members-only surface; guests
  // and non-members get the same 404 as a missing image.
  const isPrivate = community._type === "PRIVATE";
  if (
    isPrivate &&
    !(await canViewCommunity(
      { id: community.id, type: community._type },
      userId
    ))
  ) {
    return new NextResponse("Avatar not found", { status: 404 });
  }

  try {
    const response = await asmobClient.send(
      new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: avatarKey })
    );
    if (!response.Body || response.ContentLength === 0) {
      return new NextResponse("Avatar not found", { status: 404 });
    }

    const headers = new Headers();
    const storedType = response.ContentType || "";
    const effectiveType = IMAGE_CONTENT_TYPES.has(storedType)
      ? storedType
      : inferMimeFromKey(avatarKey);
    if (effectiveType && IMAGE_CONTENT_TYPES.has(effectiveType)) {
      headers.set("Content-Type", effectiveType);
      headers.set("Content-Disposition", "inline");
    } else {
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", "attachment");
    }
    headers.set("X-Content-Type-Options", "nosniff");
    // A members-only image must never enter a shared cache, or a cached copy
    // could be served to a viewer the gate just denied.
    headers.set(
      "Cache-Control",
      isPrivate ? "no-store" : "public, max-age=31536000"
    );
    headers.set("Accept-Ranges", "bytes");
    if (response.ContentLength) {
      headers.set("Content-Length", response.ContentLength.toString());
    }

    return new NextResponse(response.Body.transformToWebStream(), { headers });
  } catch {
    return new NextResponse("Avatar not found", { status: 404 });
  }
}
