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
      if (oldAvatarKey) {
        await deleteAvatar(oldAvatarKey);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        displayName: values.displayName,
        bio: values.bio,
        ...(avatarResult && {
          avatarUrl: avatarResult.url,
          avatarKey: avatarResult.key,
        }),
      },
    });

    return NextResponse.json({
      user: updatedUser,
      avatar: avatarResult,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
