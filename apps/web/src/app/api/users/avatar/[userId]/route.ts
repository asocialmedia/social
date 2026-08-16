import { avatarCache, prisma } from "@asm/db";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;

    const cachedAvatar = await avatarCache.get(userId);

    if (cachedAvatar) {
      const secureUrl =
        process.env.NODE_ENV === "production"
          ? cachedAvatar.url.replace("http://", "https://")
          : cachedAvatar.url;

      return NextResponse.json({
        ...cachedAvatar,
        url: secureUrl,
      });
    }

    const user = await prisma.user.findUnique({
      select: {
        avatarKey: true,
        avatarUrl: true,
      },
      where: { id: userId },
    });

    if (!user?.avatarUrl || !user.avatarKey) {
      return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
    }

    const secureUrl =
      process.env.NODE_ENV === "production"
        ? user.avatarUrl.replace("http://", "https://")
        : user.avatarUrl;

    const avatarData = {
      key: user.avatarKey,
      updatedAt: new Date().toISOString(),
      url: secureUrl,
    };

    await avatarCache.set(userId, avatarData);

    return NextResponse.json(avatarData);
  } catch (error) {
    console.error("Error fetching avatar:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
