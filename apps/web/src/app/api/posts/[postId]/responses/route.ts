import {
  and,
  findVisiblePost,
  fromPrismaDateTime,
  getPostDataQuery,
  mapPostData,
  prisma,
} from "@asm/db";
import type { ResponsesPage } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

// Responses are posts that reply to a post. Pagination walks the DIRECT
// responses to the anchor (posts whose parent is the anchor and that are
// themselves top-level in the thread) newest-first, then pulls in every
// descendant of each loaded response in the same page, so a branch is always
// fetched atomically. This mirrors the eddies route.
//
// The anchor may be a top-level post (its detail page) or a top-level response
// (a response permalink). For a response anchor every descendant shares its
// `threadTopId`, so the whole sub-thread is returned unpaginated.
const PAGE_SIZE = 25;
const MAX_RESPONSE_BRANCH = 500;

interface ResponseCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(response: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: response.createdAt.toISOString(),
      id: response.id,
    })
  ).toString("base64url");
}

function decodeCursor(raw: string | null): ResponseCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf-8")
    ) as Partial<ResponseCursor>;
    if (
      typeof decoded.createdAt !== "string" ||
      typeof decoded.id !== "string"
    ) {
      return null;
    }
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  // Guests can read responses; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const { postId } = await ctx.params;
  const url = new URL(request.url);
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  // Responses are derived from their post, so the post's visibility gate must
  // hold first: without it a guessed id read the thread of a post inside a
  // PRIVATE community. Returning 404 for both "missing" and "not readable"
  // avoids confirming that the post exists.
  const anchor = await findVisiblePost(postId, userId);
  if (!anchor) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  // Response anchor (a response permalink): every descendant carries
  // threadTopId = the anchor id, so one query returns the anchor plus its whole
  // sub-thread. The anchor itself is included so a permalink can render it.
  if (anchor?.parentPostId) {
    const responseQuery = getPostDataQuery(prisma.orm, userId).orderBy([
      (post) => post.createdAt.asc(),
      (post) => post.id.asc(),
    ]);
    const [anchorBranch, descendantBranch] = await Promise.all([
      responseQuery.where((post) => post.id.eq(postId)).all(),
      responseQuery.where((post) => post.threadTopId.eq(postId)).all(),
    ]);
    const branch = [...anchorBranch, ...descendantBranch]
      .toSorted(
        (left, right) =>
          fromPrismaDateTime(left.createdAt).getTime() -
            fromPrismaDateTime(right.createdAt).getTime() ||
          left.id.localeCompare(right.id)
      )
      .slice(0, MAX_RESPONSE_BRANCH)
      .map(mapPostData);
    const response: ResponsesPage = {
      previousCursor: null,
      responses: branch,
    };
    return Response.json(response);
  }

  // Post anchor: page the direct responses, then their descendants.
  let topLevelQuery = getPostDataQuery(prisma.orm, userId)
    .where((post) =>
      and(post.parentPostId.eq(postId), post.threadTopId.isNull())
    )
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.desc()]);
  if (cursor) {
    topLevelQuery = topLevelQuery.cursor({ id: cursor.id }).offset(1);
  }
  const topLevelRows = await topLevelQuery.limit(PAGE_SIZE + 1).all();
  const topLevel = topLevelRows.map(mapPostData);

  const hasMore = topLevel.length > PAGE_SIZE;
  const page = hasMore ? topLevel.slice(0, PAGE_SIZE) : topLevel;
  const topLevelIds = page.map((response) => response.id);
  const lastTopLevel = page.at(-1);

  let descendants: ReturnType<typeof mapPostData>[] = [];
  if (topLevelIds.length > 0) {
    const descendantRows = await getPostDataQuery(prisma.orm, userId)
      .where((post) => post.threadTopId.in(topLevelIds))
      .orderBy((post) => post.createdAt.asc())
      .all();
    descendants = descendantRows.map(mapPostData);
  }

  const response: ResponsesPage = {
    previousCursor: hasMore && lastTopLevel ? encodeCursor(lastTopLevel) : null,
    responses: [...page, ...descendants],
  };

  return Response.json(response);
}
