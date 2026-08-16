import { shareStatsCache } from "@asm/db";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const { postId } = await ctx.params;

  if (!postId) {
    return NextResponse.json({ error: "Post ID is required" }, { status: 400 });
  }

  try {
    const platforms = [
      "twitter",
      "facebook",
      "linkedin",
      "instagram",
      "pinterest",
      "reddit",
      "whatsapp",
      "discord",
      "email",
      "copy",
      "qr",
    ];

    const stats = await Promise.all(
      platforms.map(async (platform) => {
        const platformStats = await shareStatsCache.getStats(postId, platform);
        return {
          platform,
          ...platformStats,
        };
      })
    );

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching share stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch share statistics" },
      { status: 500 }
    );
  }
}
