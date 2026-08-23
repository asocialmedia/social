import { updateUserProfileSchema } from "@asm/auth/validation";
import type { PrivateUserData } from "@asm/db";
import { getPrivateUserSelect, prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { deleteAvatar, uploadAvatar } from "@/lib/object-storage";
import { getSessionFromApi } from "@/lib/session";

// Storage objects live under avatars/{userId}/...; only keys inside the
// caller's own namespace may ever be deleted.
function isOwnedAvatarKey(userId: string, key: string): boolean {
  return key.startsWith(`avatars/${userId}/`);
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Identity always comes from the session. The legacy client still appends
    // a userId form field; it is ignored so a crafted value can never target
    // another account.
    const userId = user.id;

    const formData = await request.formData();
    const rawValues = formData.get("values");
    const avatar = formData.get("avatar");

    let parsedValues: ReturnType<typeof updateUserProfileSchema.parse>;
    try {
      parsedValues = updateUserProfileSchema.parse(
        JSON.parse((rawValues as string) ?? "{}")
      );
    } catch {
      return Response.json(
        { error: "Invalid profile values" },
        { status: 400 }
      );
    }

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
    if (avatar instanceof File && avatar.size > 0) {
      avatarResult = await uploadAvatar(avatar, userId);
    }

    // The previous avatar key is resolved from the caller's own DB row, never
    // from client input: deleteAvatar accepts any bucket key.
    const currentUser = await prisma.user.findUnique({
      select: { avatarKey: true },
      where: { id: userId },
    });
    const oldAvatarKey =
      currentUser?.avatarKey && isOwnedAvatarKey(userId, currentUser.avatarKey)
        ? currentUser.avatarKey
        : undefined;

    // Persist first; on failure the freshly-uploaded object is orphaned, so
    // delete it rather than leak storage.
    let updatedUser: PrivateUserData | null = null;
    try {
      updatedUser = await prisma.user.update({
        data: {
          bio: parsedValues.bio,
          displayName: parsedValues.displayName,
          githubUsername: parsedValues.githubUsername || null,
          linkedinUsername: parsedValues.linkedinUsername || null,
          redditUsername: parsedValues.redditUsername || null,
          twitterUsername: parsedValues.twitterUsername || null,
          ...(avatarResult && {
            avatarKey: avatarResult.key,
            avatarUrl: avatarResult.url,
          }),
        },
        select: getPrivateUserSelect(userId),
        where: { id: userId },
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
      avatar: avatarResult,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid profile values", issues: error.issues },
        { status: 400 }
      );
    }
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
