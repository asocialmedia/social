import { prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { deleteAvatar, uploadAvatar } from "@/lib/object-storage";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const values = JSON.parse(formData.get("values") as string);
    const avatar = formData.get("avatar") as File;
    const userId = formData.get("userId") as string;
    const oldAvatarKey = formData.get("oldAvatarKey") as string;

    let avatarResult:
      | {
          key: string;
          url: string;
          type: string;
          mimeType: string;
          size: number;
          originalName: string;
        }
      | undefined;
    if (avatar) {
      avatarResult = await uploadAvatar(avatar, userId);
    }

    // Persist first; on failure the freshly-uploaded object is orphaned, so
    // delete it rather than leak storage.
    let updatedUser: import("@asm/db").User | null = null;
    try {
      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          displayName: values.displayName,
          bio: values.bio,
          githubUsername: values.githubUsername || null,
          linkedinUsername: values.linkedinUsername || null,
          twitterUsername: values.twitterUsername || null,
          redditUsername: values.redditUsername || null,
          ...(avatarResult && {
            avatarUrl: avatarResult.url,
            avatarKey: avatarResult.key,
          }),
        },
      });
    } catch (error) {
      if (avatarResult) {
        try {
          await deleteAvatar(avatarResult.key);
        } catch (cleanupError) {
          console.error(
            "Failed to delete orphaned avatar object:",
            cleanupError
          );
        }
      }
      throw error;
    }

    // Only after the DB write succeeds, remove the old avatar object.
    if (avatarResult && oldAvatarKey) {
      try {
        await deleteAvatar(oldAvatarKey);
      } catch (deleteError) {
        console.error("Failed to delete old avatar:", deleteError);
      }
    }

    return NextResponse.json({
      user: updatedUser,
      avatar: avatarResult,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
