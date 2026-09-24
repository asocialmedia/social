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

import { getSessionFromApi } from "@/lib/auth/session";

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
