import { getPrivateUserSelect, prisma } from "@asm/db";
import { NextResponse } from "next/server";

import { deleteBanner } from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";

// Banner uploads go through the media pipeline (presigned PUT -> quarantine ->
// ClamAV scan -> publish) and arrive here as finished Media rows. Linking only
// accepts READY rows so a banner can never point at unscanned bytes. Legacy
// banners live under banners/{userId}/... and keep serving unchanged.
function isOwnedLegacyBannerKey(userId: string, key: string): boolean {
  return key.startsWith(`banners/${userId}/`);
}

// Only keys inside the caller's own legacy namespace may ever be deleted, and
// only when no Media row owns the object: pipeline originals are
// content-addressed and their rows stay addressable after unlinking.
async function deletableLegacyBannerKey(
  userId: string,
  bannerMediaId: string | null,
  bannerKey: string | null
): Promise<string | null> {
  if (!bannerKey || !isOwnedLegacyBannerKey(userId, bannerKey)) {
    return null;
  }
  if (bannerMediaId) {
    const media = await prisma.media.findUnique({
      select: { id: true },
      where: { id: bannerMediaId },
    });
    // The Media row is gone (reaped): its orphaned object can go too.
    return media ? null : bannerKey;
  }
  return bannerKey;
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
        { error: "Banner upload is not ready yet" },
        { status: 409 }
      );
    }
    if (media.type !== "IMAGE") {
      return Response.json(
        { error: "Only images can be used as a banner" },
        { status: 415 }
      );
    }

    const currentUser = await prisma.user.findUnique({
      select: { bannerKey: true, bannerMediaId: true },
      where: { id: userId },
    });

    // Serving flows through /api/users/banner/{userId}/image exactly as for
    // legacy uploads; storing the published original key there keeps GIFs
    // animated while derivative URLs stay available via /api/media/{id}.
    // For static images the pipeline's promotion step later swaps the key to
    // the optimized derivative and deletes the original.
    const bannerKey = media.publishedKey ?? media.key;
    const bannerUrl = `/api/users/banner/${userId}/image`;

    await prisma.user.update({
      data: {
        bannerKey,
        bannerMediaId: media.id,
        bannerUrl,
      },
      select: getPrivateUserSelect(userId),
      where: { id: userId },
    });

    // Best-effort removal of the replaced legacy banner object. Superseded
    // pipeline banners are purged below (objects + derivatives + row + quota
    // refund); the reaper's bannerOf guard protects the new link meanwhile.
    const previousMediaId =
      currentUser?.bannerMediaId && currentUser.bannerMediaId !== media.id
        ? currentUser.bannerMediaId
        : null;
    const oldLegacyKey = await deletableLegacyBannerKey(
      userId,
      currentUser?.bannerMediaId ?? null,
      currentUser?.bannerKey ?? null
    );
    if (oldLegacyKey && oldLegacyKey !== bannerKey) {
      try {
        await deleteBanner(oldLegacyKey);
      } catch (deleteError) {
        console.error("Failed to delete old banner:", deleteError);
      }
    }
    if (previousMediaId) {
      try {
        const { purgeSupersededProfileMedia } = await import("@asm/db");
        await purgeSupersededProfileMedia(previousMediaId, userId);
      } catch (cleanupError) {
        console.error("Failed to delete old banner media:", cleanupError);
      }
    }

    // Promotion race cover: derivatives may have committed before the link
    // landed, in which case the process stage's promotion call saw no link
    // yet. Running it here (best-effort) swaps static banners to their
    // optimized derivative immediately when that happened.
    try {
      const { promoteProfileDerivative } = await import("@asm/db");
      await promoteProfileDerivative(media.id, "banner");
    } catch (promoteError) {
      console.error("Failed to promote banner derivative:", promoteError);
    }

    return NextResponse.json({ banner: { key: bannerKey, url: bannerUrl } });
  } catch (error) {
    console.error("Banner update error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update banner",
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
      select: { bannerKey: true, bannerMediaId: true },
      where: { id: userId },
    });

    // Clear the references first; if that fails, the banner stays intact.
    const updatedUser = await prisma.user.update({
      data: {
        bannerKey: null,
        bannerMediaId: null,
        bannerUrl: null,
      },
      select: getPrivateUserSelect(userId),
      where: { id: userId },
    });

    // Best-effort removal of the underlying object (legacy uploads only).
    // Unlinked pipeline banners go through the cleanup worker, which refunds
    // quota and deletes objects + row once nothing references them.
    const legacyKey = await deletableLegacyBannerKey(
      userId,
      currentUser?.bannerMediaId ?? null,
      currentUser?.bannerKey ?? null
    );
    if (legacyKey) {
      try {
        await deleteBanner(legacyKey);
      } catch (error) {
        console.error("Failed to delete banner object:", error);
      }
    } else if (currentUser?.bannerMediaId) {
      try {
        const { purgeSupersededProfileMedia } = await import("@asm/db");
        await purgeSupersededProfileMedia(currentUser.bannerMediaId, userId);
      } catch (error) {
        console.error("Failed to delete banner media:", error);
      }
    }

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error("Banner deletion error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete banner",
      },
      { status: 500 }
    );
  }
}
