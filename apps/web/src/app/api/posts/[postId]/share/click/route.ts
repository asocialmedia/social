import {
  enqueueShareEvent,
  getClientIpFromRequest,
  hashViewerId,
  shareStatsCache,
} from "@asm/db";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/session";

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

    // One click per viewer per post+platform inside the window: signed-in
    // users dedupe by user id, anonymous by hashed IP. The claim and the
    // counter bump run atomically so a duplicate click can never double-count.
    // Fails open so real clicks are never dropped when Redis is unavailable.
    const session = await getSessionFromApi();
    const viewer = session?.user?.id
      ? `u:${session.user.id}`
      : `a:${hashViewerId(getClientIpFromRequest(request))}`;
    const { claimed } = await shareStatsCache.claimAndIncrementClick(
      postId,
      platform,
      `share:click:seen:${postId}:${platform}:${viewer}`,
      3600
    );
    if (claimed) {
      try {
        await enqueueShareEvent(postId, platform, "click");
      } catch (error) {
        console.error("Failed to enqueue click event:", error);
      }
    }
    const clicks = await shareStatsCache.getClicks(postId, platform);
    return NextResponse.json({ clicks });
  } catch (error) {
    console.error("Error tracking click:", error);
    return NextResponse.json(
      { error: "Failed to track click" },
      { status: 500 }
    );
  }
}
