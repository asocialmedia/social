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

    if (oldBannerKey) {
      try {
        await deleteBanner(oldBannerKey);
        console.log("Old banner deleted successfully:", oldBannerKey);
      } catch (deleteError) {
        console.error("Failed to delete old banner:", deleteError);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        bannerUrl,
        bannerKey: result.key,
      },
    });

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
    await deleteBanner(bannerKey);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        bannerUrl: null,
        bannerKey: null,
      },
    });

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
