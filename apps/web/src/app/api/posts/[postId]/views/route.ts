import { debugLog } from "@asm/config/debug";
import { postViewsCache } from "@asm/db";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/session";

export async function POST(
  _request: NextRequest,
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

    // Pass the authenticated user id so the counter dedupes per user+post (a
    // single user cannot inflate a count by refreshing). Anonymous views still
    // count every hit.
    const session = await getSessionFromApi();
    const userId = session?.user?.id;

    const newCount = await postViewsCache.incrementView(postId, userId);
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
