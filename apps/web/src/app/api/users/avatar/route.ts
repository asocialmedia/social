import type { User } from "@asm/db";
import { avatarCache, prisma } from "@asm/db";
import { NextResponse } from "next/server";

import { deleteAvatar, uploadAvatar } from "@/lib/object-storage";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("userId") as string;
    const oldAvatarKey = formData.get("oldAvatarKey") as string;

    if (!(file && userId)) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    console.log("Avatar update started:", {
      newFile: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
      oldAvatarKey: oldAvatarKey || "none",
      userId,
    });

    const result = await uploadAvatar(file, userId);

    const avatarUrl =
      process.env.NODE_ENV === "production"
        ? result.url.replace("http://", "https://")
        : result.url;

    // Update the DB row first. If it fails, the freshly-uploaded object is
    // orphaned, so delete it to avoid leaking storage.
    let updatedUser: User | null = null;
    try {
      updatedUser = await prisma.user.update({
        data: {
          avatarKey: result.key,
          avatarUrl,
        },
        where: { id: userId },
      });
    } catch (error) {
      console.error(
        "Failed to persist avatar, deleting uploaded object:",
        error
      );
      try {
        await deleteAvatar(result.key);
      } catch (cleanupError) {
        console.error("Failed to delete orphaned avatar object:", cleanupError);
      }
      throw error;
    }

    // Only after the DB write succeeds, remove the old avatar object.
    if (oldAvatarKey) {
      try {
        await deleteAvatar(oldAvatarKey);
        console.log("Old avatar deleted successfully:", oldAvatarKey);
      } catch (deleteError) {
        console.error("Failed to delete old avatar:", deleteError);
      }
    }

    await avatarCache.set(userId, {
      key: result.key,
      updatedAt: new Date().toISOString(),
      url: avatarUrl,
    });

    console.log("Avatar update completed successfully:", {
      newAvatarKey: result.key,
      userId,
    });

    return NextResponse.json({
      avatar: { ...result, url: avatarUrl },
      user: updatedUser,
    });
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

export async function DELETE(request: Request) {
  try {
    const { avatarKey, userId } = await request.json();

    if (!(avatarKey && userId)) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    // Clear the DB reference first; if that fails, the avatar stays intact.
    const updatedUser = await prisma.user.update({
      data: {
        avatarKey: null,
        avatarUrl: null,
      },
      where: { id: userId },
    });

    await avatarCache.del(userId);

    // Best-effort removal of the object from storage.
    try {
      await deleteAvatar(avatarKey);
    } catch (error) {
      console.error("Failed to delete avatar object:", error);
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
