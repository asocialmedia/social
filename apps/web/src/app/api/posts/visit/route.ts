import { and, prisma, toPrismaDateTime } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await request.json().catch(() => null)) as {
    postId?: string;
  } | null;

  if (!body?.postId) {
    return Response.json({ error: "postId is required" }, { status: 400 });
  }

  const { postId } = body;
  const post = await prisma.orm.public.Posts.select("id")
    .where({ id: postId })
    .first();

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  // Upsert keeps one row per user+post, bumping visitedAt so the history
  // card reflects "most recently viewed" order.
  const existingVisit = await prisma.orm.public.PostVisits.select("id")
    .where((visit) => and(visit.postId.eq(postId), visit.userId.eq(userId)))
    .first();
  await (existingVisit
    ? prisma.orm.public.PostVisits.where({ id: existingVisit.id }).update({
        visitedAt: toPrismaDateTime(new Date()),
      })
    : prisma.orm.public.PostVisits.create({
        postId,
        userId,
      }));

  return Response.json({ success: true });
}
