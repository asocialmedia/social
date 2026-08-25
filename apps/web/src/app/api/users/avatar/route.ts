import { avatarCache, getPrivateUserSelect, prisma } from "@asm/db";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";

import { ASMOB_BUCKET, asmobClient, deleteAvatar } from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";

// Avatar uploads go through the media pipeline (presigned PUT -> quarantine ->
// ClamAV scan -> publish) and arrive here as finished Media rows. Linking only
// accepts READY rows so an avatar can never point at unscanned bytes. Legacy
// avatars live under avatars/{userId}/... and keep serving unchanged.
function isOwnedLegacyAvatarKey(userId: string, key: string): boolean {
  return key.startsWith(`avatars/${userId}/`);
}

// Only keys inside the caller's own legacy namespace may ever be deleted, and
// only when no Media row owns the object: pipeline originals are
// content-addressed and their rows stay addressable after unlinking.
async function deletableLegacyAvatarKey(
  userId: string,
  avatarMediaId: string | null,
  avatarKey: string | null
): Promise<string | null> {
  if (!avatarKey || !isOwnedLegacyAvatarKey(userId, avatarKey)) {
    return null;
  }
  if (avatarMediaId) {
    const media = await prisma.media.findUnique({
      select: { id: true },
      where: { id: avatarMediaId },
    });
    // The Media row is gone (reaped): its orphaned object can go too.
    return media ? null : avatarKey;
  }
  return avatarKey;
}

// Purges a superseded pipeline avatar: objects (original + derivatives),
// quota refund, then the row itself. Skips rows that got linked to a post or
// comment in the meantime — those belong to the pipeline lifecycle now. The
// user's link was already cleared before this runs, so a re-link in between
// would have set a different avatarMediaId; purge only proceeds when the
// media is still owned by this user.
async function purgeSupersededAvatarMedia(mediaId: string, userId: string) {
  const media = await prisma.media.findUnique({
    select: {
      commentId: true,
      key: true,
      originalKey: true,
      postId: true,
      publishedKey: true,
      size: true,
      status: true,
      thumbnailKey: true,
      userId: true,
    },
    where: { id: mediaId },
  });
  if (!media || media.postId || media.commentId || media.userId !== userId) {
    return;
  }

  for (const objectKey of [
    media.originalKey,
    media.publishedKey,
    media.key,
    media.thumbnailKey,
  ]) {
    if (!objectKey) {
      continue;
    }
    try {
      await asmobClient.send(
        new DeleteObjectCommand({ Bucket: ASMOB_BUCKET, Key: objectKey })
      );
    } catch (error) {
      console.error("Failed to delete superseded avatar object:", error);
    }
  }

  // Derivatives live under their own keys; collect them before deleting the
  // row. Best-effort: a missed derivative gets caught by the maintenance
  // sweep eventually or simply orphans harmlessly.
  try {
    const derivatives = await prisma.mediaDerivative.findMany({
      select: { key: true },
      where: { mediaId },
    });
    for (const derivative of derivatives) {
      try {
        await asmobClient.send(
          new DeleteObjectCommand({ Bucket: ASMOB_BUCKET, Key: derivative.key })
        );
      } catch (error) {
        console.error("Failed to delete avatar derivative:", error);
      }
    }
  } catch (error) {
    console.error("Failed to list avatar derivatives:", error);
  }

  try {
    const { redis } = await import("@asm/db");
    if (
      media.userId &&
      media.size > 0 &&
      !["UPLOADING", "REJECTED", "DELETED"].includes(media.status)
    ) {
      await redis.decrby(`user:storage:${media.userId}`, media.size);
    }
  } catch (error) {
    console.error("Failed to refund storage quota:", error);
  }

  await prisma.media.delete({ where: { id: mediaId } });
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = user.id;

    let payload: { mediaId?: unknown };
    try {
      payload = (await request.json()) as { mediaId?: unknown };
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (
      !payload.mediaId ||
      typeof payload.mediaId !== "string" ||
      payload.mediaId.length > 64
    ) {
      return Response.json({ error: "mediaId is required" }, { status: 400 });
    }

    const media = await prisma.media.findUnique({
      select: {
        id: true,
        key: true,
        publishedKey: true,
        status: true,
        type: true,
        userId: true,
      },
      where: { id: payload.mediaId },
    });
    if (!media || media.userId !== userId) {
      // Deliberately opaque about other users' rows.
      return Response.json({ error: "Media not found" }, { status: 404 });
    }
    if (media.status !== "READY") {
      return Response.json(
        { error: "Avatar upload is not ready yet" },
        { status: 409 }
      );
    }
    if (media.type !== "IMAGE") {
      return Response.json(
        { error: "Only images can be used as an avatar" },
        { status: 415 }
      );
    }

    const currentUser = await prisma.user.findUnique({
      select: { avatarKey: true, avatarMediaId: true },
      where: { id: userId },
    });

    // Serving flows through /api/users/avatar/{userId}/image exactly as for
    // legacy uploads; storing the published original key there keeps GIFs
    // animated while derivative URLs stay available via /api/media/{id}.
    const avatarKey = media.publishedKey ?? media.key;
    const avatarUrl = `/api/users/avatar/${userId}/image`;

    const updatedUser = await prisma.user.update({
      data: {
        avatarKey,
        avatarMediaId: media.id,
        avatarUrl,
      },
      select: getPrivateUserSelect(userId),
      where: { id: userId },
    });

    await avatarCache.set(userId, {
      key: avatarKey,
      updatedAt: new Date().toISOString(),
      url: avatarUrl,
    });

    // Best-effort removal of the replaced legacy avatar object. Superseded
    // pipeline avatars are handed to the cleanup worker instead: the delayed
    // job reaps objects + row unless the media got re-linked in the meantime
    // (avatarOf guards it).
    const previousMediaId =
      currentUser?.avatarMediaId && currentUser.avatarMediaId !== media.id
        ? currentUser.avatarMediaId
        : null;
    const oldLegacyKey = await deletableLegacyAvatarKey(
      userId,
      currentUser?.avatarMediaId ?? null,
      currentUser?.avatarKey ?? null
    );
    if (oldLegacyKey && oldLegacyKey !== avatarKey) {
      try {
        await deleteAvatar(oldLegacyKey);
      } catch (deleteError) {
        console.error("Failed to delete old avatar:", deleteError);
      }
    }
    if (previousMediaId) {
      try {
        await purgeSupersededAvatarMedia(previousMediaId, userId);
      } catch (cleanupError) {
        console.error("Failed to delete old avatar media:", cleanupError);
      }
    }

    return NextResponse.json({ avatar: { key: avatarKey, url: avatarUrl } });
  } catch (error) {
    console.error("Avatar update error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update avatar",
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = user.id;

    const currentUser = await prisma.user.findUnique({
      select: { avatarKey: true, avatarMediaId: true },
      where: { id: userId },
    });

    // Clear the references first; if that fails, the avatar stays intact.
    const updatedUser = await prisma.user.update({
      data: {
        avatarKey: null,
        avatarMediaId: null,
        avatarUrl: null,
      },
      select: getPrivateUserSelect(userId),
      where: { id: userId },
    });

    await avatarCache.del(userId);

    // Best-effort removal of the underlying object (legacy uploads only).
    // Unlinked pipeline avatars go through the cleanup worker, which refunds
    // quota and deletes objects + row once nothing references them.
    const legacyKey = await deletableLegacyAvatarKey(
      userId,
      currentUser?.avatarMediaId ?? null,
      currentUser?.avatarKey ?? null
    );
    if (legacyKey) {
      try {
        await deleteAvatar(legacyKey);
      } catch (error) {
        console.error("Failed to delete avatar object:", error);
      }
    } else if (currentUser?.avatarMediaId) {
      try {
        await purgeSupersededAvatarMedia(currentUser.avatarMediaId, userId);
      } catch (error) {
        console.error("Failed to delete avatar media:", error);
      }
    }

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Avatar deletion error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete avatar",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }
    const cachedAvatar = await avatarCache.get(userId);
    if (cachedAvatar) {
      return NextResponse.json(cachedAvatar);
    }
    const user = await prisma.user.findUnique({
      select: {
        avatarKey: true,
        avatarUrl: true,
      },
      where: { id: userId },
    });

    if (!user?.avatarUrl || !user.avatarKey) {
      return new NextResponse("Avatar not found", { status: 404 });
    }

    await avatarCache.set(userId, {
      key: user.avatarKey,
      updatedAt: new Date().toISOString(),
      url: user.avatarUrl,
    });

    return NextResponse.json({
      key: user.avatarKey,
      url: user.avatarUrl,
    });
  } catch (error) {
    console.error("Error fetching avatar:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch avatar",
      },
      { status: 500 }
    );
  }
}
