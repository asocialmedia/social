import { getCommentDataInclude, prisma } from "@asm/db";
import type { CommentsPage } from "@asm/db";

import { createComment } from "@/components/comments/comment-service";
import { getSessionFromApi } from "@/lib/session";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { postId } = await ctx.params;
  const body = (await request.json()) as {
    content?: string;
    mediaIds?: string[];
    parentId?: string;
  };

  try {
    const comment = await createComment({
      content: body.content ?? "",
      mediaIds: body.mediaIds,
      parentId: body.parentId,
      postId,
      userId: user.id,
    });
    return Response.json(comment);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create comment";
    return Response.json({ error: message }, { status: 400 });
  }
}

// Pagination walks top-level comments (newest first) and pulls in every
// descendant of each loaded top-level comment in the same page, so a thread
// is always fetched atomically. The cursor encodes the (createdAt, id) pair of
// the last top-level comment on the previous page.
const PAGE_SIZE = 25;

interface CommentCursor {
  createdAt: string;
  id: string;
}

export function encodeCommentCursor(comment: {
  createdAt: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: comment.createdAt.toISOString(),
      id: comment.id,
    })
  ).toString("base64url");
}

export function decodeCommentCursor(raw: string | null): CommentCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf-8")
    ) as Partial<CommentCursor>;
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
  // Guests can read comments; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const { postId } = await ctx.params;
  const url = new URL(request.url);
  const cursor = decodeCommentCursor(url.searchParams.get("cursor"));

  const where = { parentId: null, postId };

  const topLevel = await prisma.comment.findMany({
    include: getCommentDataInclude(userId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    where,
    ...(cursor
      ? {
          cursor: { id: cursor.id },
          skip: 1,
        }
      : {}),
  });

  const hasMore = topLevel.length > PAGE_SIZE;
  const page = hasMore ? topLevel.slice(0, PAGE_SIZE) : topLevel;
  const topLevelIds = page.map((comment) => comment.id);
  const lastTopLevel = page.at(-1);

  const descendants =
    topLevelIds.length > 0
      ? await prisma.comment.findMany({
          include: getCommentDataInclude(userId),
          orderBy: { createdAt: "asc" },
          where: { postId, rootId: { in: topLevelIds } },
        })
      : [];

  const response: CommentsPage = {
    comments: [...page, ...descendants],
    previousCursor:
      hasMore && lastTopLevel ? encodeCommentCursor(lastTopLevel) : null,
  };

  return Response.json(response);
}
