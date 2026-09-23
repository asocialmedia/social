import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  hideRecommendationPost,
  unhideRecommendationPost,
} from "@/recommendations/actions";

// REST twin of the hide/unhide server actions for native clients, which
// cannot call Next server actions. POST hides a post from ranked feeds,
// DELETE undoes it. Both are idempotent, so a client retry is always safe.
const logger = createLogger({ serviceName: "api-not-interested" });

async function readPostId(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as {
    postId?: unknown;
  } | null;
  const postId = body?.postId;
  return typeof postId === "string" && postId.length > 0 && postId.length < 64
    ? postId
    : null;
}

async function handle(request: Request, hide: boolean): Promise<Response> {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const postId = await readPostId(request);
  if (!postId) {
    return Response.json({ error: "postId is required" }, { status: 400 });
  }
  try {
    await (hide
      ? hideRecommendationPost(postId)
      : unhideRecommendationPost(postId));
    return Response.json({ hidden: hide, postId });
  } catch (error) {
    if (error instanceof Error && error.message === "Post not found") {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }
    logger.error(
      { error, hide, postId, userId: session.user.id },
      "not interested update failed"
    );
    return Response.json(
      { error: "That didn't go through, give it another try?" },
      { status: 500 }
    );
  }
}

export function POST(request: Request) {
  return handle(request, true);
}

export function DELETE(request: Request) {
  return handle(request, false);
}
