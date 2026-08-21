import { debugLog } from "@asm/config/debug";
import { getClientIpFromRequest, hashViewerId, postViewsCache } from "@asm/db";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/session";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ postId: string }> }
) {
  try {
    const { postId } = await context.params;
    debugLog.views(`Received view increment request for post: ${postId}`);

    if (!postId) {
      debugLog.views("Missing postId in request");
      return NextResponse.json(
        { error: "Post ID is required" },
        { status: 400 }
      );
    }

    // Signed-in viewers dedupe per user+post; anonymous viewers dedupe per
    // hashed IP+post (see postViewsCache.incrementView). Both fail open, so
    // genuine views are never lost to an infrastructure hiccup.
    const session = await getSessionFromApi();
    const userId = session?.user?.id;
    const viewerHash = userId
      ? undefined
      : hashViewerId(getClientIpFromRequest(request));

    const newCount = await postViewsCache.incrementView(postId, {
      userId,
      viewerHash,
    });
    debugLog.views(`Incremented view count for post: ${postId} to ${newCount}`);

    return NextResponse.json({
      success: true,
      viewCount: newCount,
    });
  } catch (error) {
    debugLog.views("Error incrementing view count:", error);
    return NextResponse.json(
      { error: "Failed to increment view count" },
      { status: 500 }
    );
  }
}
