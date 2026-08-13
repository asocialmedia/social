import { prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { deleteBanner, uploadBanner } from "@/lib/object-storage";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;
    const oldBannerKey = formData.get("oldBannerKey") as string;

    if (!(file && userId)) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    console.log("Banner update started:", {
      userId,
      oldBannerKey: oldBannerKey || "none",
      newFile: {
        name: file.name,
        type: file.type,
        size: file.size,
      },
    });

    const result = await uploadBanner(file, userId);

    const bannerUrl =
      process.env.NODE_ENV === "production"
        ? result.url.replace("http://", "https://")
        : result.url;

    // Persist first; on failure the freshly-uploaded object is orphaned, so
    // delete it rather than leak storage.
    let updatedUser: import("@asm/db").User | null = null;
    try {
      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          bannerUrl,
          bannerKey: result.key,
        },
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
      userId,
      newBannerKey: result.key,
    });

    return NextResponse.json({
      user: updatedUser,
      banner: { ...result, url: bannerUrl },
    });
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

export async function DELETE(request: Request) {
  try {
    const { bannerKey, userId } = await request.json();

    if (!(bannerKey && userId)) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    // Clear the DB reference first; if that fails, the banner stays intact.
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        bannerUrl: null,
        bannerKey: null,
      },
    });

    // Best-effort removal of the object from storage.
    try {
      await deleteBanner(bannerKey);
    } catch (error) {
      console.error("Failed to delete banner object:", error);
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
