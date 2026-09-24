// REST eddie deletion for native clients: runs the same `softDeleteComment`
// the web `deleteComment` server action uses (owner only, content cleared,
// aura positions reversed, realtime delete published). Deleting an eddie
// that is already deleted is a no-op success, so client retries are safe.
import { prisma } from "@asm/db";

import { softDeleteComment } from "@/components/comments/data/comment-service";
import { getSessionFromApi } from "@/lib/auth/session";
import { getWebLogger } from "@/lib/otel";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ commentId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { commentId } = await ctx.params;

  const existing = await prisma.orm.public.Comments.select("deleted", "userId")
    .where({ id: commentId })
    .first();
  if (!existing) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.userId !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (existing.deleted) {
    return Response.json({ deleted: true, id: commentId });
  }

  try {
    const comment = await softDeleteComment(commentId, user.id);
    return Response.json(comment);
  } catch (error) {
    const logger = getWebLogger();
    if (logger) {
      logger.error(
        { commentId, error, userId: user.id },
        "Eddie delete failed"
      );
    } else {
      console.error("Eddie delete failed:", error);
    }
    return Response.json(
      { error: "Couldn't delete that eddie, try again?" },
      { status: 500 }
    );
  }
}
