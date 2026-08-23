import {
  enqueueShareEvent,
  getTrustedIngressIp,
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

    // One share per viewer per post+platform inside the window: signed-in
    // users dedupe by user id, anonymous viewers by TRUSTED ingress IP only.
    // The spoofable x-forwarded-for/x-real-ip fallbacks are deliberately not
    // consulted here: rotating them would otherwise mint fresh viewer
    // identities and inflate the durable counter. Anonymous requests without
    // a trusted ingress header collapse into one "unknown" bucket, which
    // fails closed. The claim and the counter bump run atomically so
    // duplicates never count; it fails open (claimed=true) when Redis is
    // unreachable so real shares are never dropped.
    const session = await getSessionFromApi();
    const viewer = session?.user?.id
      ? `u:${session.user.id}`
      : `a:${hashViewerId(getTrustedIngressIp(request.headers))}`;
    const { claimed, shares } = await shareStatsCache.claimAndIncrementShare(
      postId,
      platform,
      `share:seen:${postId}:${platform}:${viewer}`,
      3600
    );
    if (claimed) {
      try {
        await enqueueShareEvent(postId, platform, "share");
      } catch (error) {
        console.error("Failed to enqueue share event:", error);
      }
    }
    return NextResponse.json({ shares });
  } catch (error) {
    console.error("Error tracking share:", error);
    return NextResponse.json(
      { error: "Failed to track share" },
      { status: 500 }
    );
  }
}
