import {
  and,
  communityVisibilityWhere,
  getPostAncestors,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import type { PostData } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";
import { deletePost, updatePostModeration } from "@/posts/actions";
import type { PostModerationChanges } from "@/posts/actions";

const logger = createLogger({ serviceName: "post-api" });

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  // Guests can read a public post: the web detail page already serves them via
  // a direct Prisma read, and the sibling related/comments routes allow the
  // same. Resolving per-user fields against an empty id keeps the reply
  // guest-shaped (no vote/bookmark state) without a second code path.
  const userId = session?.user?.id ?? "";

  const { postId } = await ctx.params;
  // A direct post read must honor the same community visibility as every feed:
  // a post inside a PRIVATE community the viewer cannot read is a 404, not a
  // leak of its content through a known id. For a guest that means public
  // communities only.
  const visibility = communityVisibilityWhere(userId);
  const postQuery = getPostDataQuery(prisma.orm, userId);
  const postRow = await postQuery
    .where((post) => and(post.id.eq(postId), visibility(post)))
    .first();
  let post = postRow ? mapPostData(postRow) : null;
  if (!post && postId.length >= 8) {
    const candidateIds = await prisma.orm.public.Posts.select("id")
      .where((candidate) => visibility(candidate))
      .all();
    const matchingIds = candidateIds
      .filter((candidate) => candidate.id.startsWith(postId))
      .slice(0, 2);
    if (matchingIds.length === 1) {
      const matchId = matchingIds[0]?.id;
      if (matchId) {
        const matchRow = await postQuery.where({ id: matchId }).first();
        post = matchRow ? mapPostData(matchRow) : null;
      }
    }
  }
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const [hydrated] = await hydrateViewCounts([post]);
  let ancestors: PostData[] = [];
  if (hydrated.parentPostId) {
    ancestors = await getPostAncestors(hydrated.parentPostId, userId);
  }

  return Response.json({ ancestors, post: hydrated });
}

// The post author deleting their own post. Delegates to the server action so
// the aura reversal, the pre-captured media key sweep, the Redis view cleanup,
// the queue enqueue and the response/community aggregate invalidation all stay
// in exactly one implementation - a second copy here would drift from the aura
// ledger rules the action encodes.
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const { postId } = await ctx.params;
  try {
    const deleted = await deletePost(postId);
    return Response.json({ deleted: true, id: deleted.id });
  } catch (error) {
    return postActionErrorResponse(error, postId, "delete");
  }
}

// Reversible moderation flags: `moderated` and `explicitContent`. Same
// delegation reason as DELETE. The action rebuilds a fresh object from only
// these two fields, so a crafted body can never reach Prisma with anything
// else (content, userId, aura, counters).
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const { postId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const changes: PostModerationChanges = {};
  if (typeof raw.explicitContent === "boolean") {
    changes.explicitContent = raw.explicitContent;
  }
  if (typeof raw.moderated === "boolean") {
    changes.moderated = raw.moderated;
  }
  if (Object.keys(changes).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await updatePostModeration(postId, changes);
    return Response.json({
      post: {
        explicitContent: updated.explicitContent,
        id: updated.id,
        moderated: updated.moderated,
      },
    });
  } catch (error) {
    return postActionErrorResponse(error, postId, "moderate");
  }
}

// The post actions throw plain Errors with messages already written for a
// human, so the message is forwarded and only the status needs deciding.
// "Unauthorized" is 401, "Post not found" is 404, everything else is a 400 the
// client can show verbatim.
function postActionErrorResponse(
  error: unknown,
  postId: string,
  operation: string
): Response {
  const message =
    error instanceof Error ? error.message : "Couldn't complete that";
  if (message === "Unauthorized") {
    return Response.json({ error: message }, { status: 401 });
  }
  if (message === "Post not found") {
    return Response.json({ error: message }, { status: 404 });
  }
  logger.error(
    { error: String(error), operation, postId },
    "post action failed"
  );
  return Response.json({ error: message }, { status: 400 });
}
