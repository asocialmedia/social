import { shareStatsCache } from "@asm/db";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ postId: string }> }
) {
  const { postId } = await ctx.params;

  if (!postId) {
    return NextResponse.json({ error: "Post ID is required" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { platform } = body;

    if (!platform) {
      return NextResponse.json(
        { error: "Platform is required" },
        { status: 400 }
      );
    }

    const shares = await shareStatsCache.incrementShare(postId, platform);
    return NextResponse.json({ shares });
  } catch (error) {
    console.error("Error tracking share:", error);
    return NextResponse.json(
      { error: "Failed to track share" },
      { status: 500 }
    );
  }
}
