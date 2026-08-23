import { getPrivateUserSelect, prisma } from "@asm/db";
import { NextResponse } from "next/server";

import {
  deleteBanner,
  UploadValidationError,
  uploadBanner,
} from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";

// Storage objects live under banners/{userId}/...; only keys inside the
// caller's own namespace may ever be deleted.
function isOwnedBannerKey(userId: string, key: string): boolean {
  return key.startsWith(`banners/${userId}/`);
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Identity comes from the session only; any client-supplied userId form
    // field is ignored so a crafted request can never target another account.
    const userId = user.id;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    console.log("Banner update started:", {
      newFile: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
      userId,
    });

    const result = await uploadBanner(file, userId);

    const bannerUrl =
      process.env.NODE_ENV === "production"
        ? result.url.replace("http://", "https://")
        : result.url;

    // The previous banner key is resolved from the caller's own DB row, never
    // from client input: deleteBanner accepts any bucket key.
    const currentUser = await prisma.user.findUnique({
      select: { bannerKey: true },
      where: { id: userId },
    });
    const oldBannerKey =
      currentUser?.bannerKey && isOwnedBannerKey(userId, currentUser.bannerKey)
        ? currentUser.bannerKey
        : undefined;

    // Persist first; on failure the freshly-uploaded object is orphaned, so
    // delete it rather than leak storage.
    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        data: {
          bannerKey: result.key,
          bannerUrl,
        },
        select: getPrivateUserSelect(userId),
        where: { id: userId },
      });
    } catch (error) {
      console.error(
        "Failed to persist banner, deleting uploaded object:",
        error
      );
      try {
        await deleteBanner(result.key);
      } catch (cleanupError) {
        console.error("Failed to delete orphaned banner object:", cleanupError);
      }
      throw error;
    }

    // Only after the DB write succeeds, remove the old banner object.
    if (oldBannerKey) {
      try {
        await deleteBanner(oldBannerKey);
        console.log("Old banner deleted successfully:", oldBannerKey);
      } catch (deleteError) {
        console.error("Failed to delete old banner:", deleteError);
      }
    }

    console.log("Banner update completed successfully:", {
      newBannerKey: result.key,
      userId,
    });

    return NextResponse.json({
      banner: { ...result, url: bannerUrl },
      user: updatedUser,
    });
  } catch (error) {
    console.error("Banner update error:", error);
    // Client-fixable rejections (type/size/content) are 4xx, not 5xx.
    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
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

    // Resolve the stored key server-side: the client never dictates which
    // bucket object is removed.
    const currentUser = await prisma.user.findUnique({
      select: { bannerKey: true },
      where: { id: userId },
    });
    const bannerKey =
      currentUser?.bannerKey && isOwnedBannerKey(userId, currentUser.bannerKey)
        ? currentUser.bannerKey
        : undefined;

    // Clear the DB reference first; if that fails, the banner stays intact.
    const updatedUser = await prisma.user.update({
      data: {
        bannerKey: null,
        bannerUrl: null,
      },
      select: getPrivateUserSelect(userId),
      where: { id: userId },
    });

    // Best-effort removal of the object from storage.
    if (bannerKey) {
      try {
        await deleteBanner(bannerKey);
      } catch (error) {
        console.error("Failed to delete banner object:", error);
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
