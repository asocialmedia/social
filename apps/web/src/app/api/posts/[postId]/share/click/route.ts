import { enqueueShareEvent, shareStatsCache } from "@asm/db";
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

    const clicks = await shareStatsCache.incrementClick(postId, platform);
    enqueueShareEvent(postId, platform, "click").catch((error: unknown) => {
      console.error("Failed to enqueue click event:", error);
    });
    return NextResponse.json({ clicks });
  } catch (error) {
    console.error("Error tracking click:", error);
    return NextResponse.json(
      { error: "Failed to track click" },
      { status: 500 }
    );
  }
}
