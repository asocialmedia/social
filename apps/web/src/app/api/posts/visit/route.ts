import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    postId?: string;
  } | null;

  if (!body?.postId) {
    return Response.json({ error: "postId is required" }, { status: 400 });
  }

  const post = await prisma.post.findUnique({
    select: { id: true },
    where: { id: body.postId },
  });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  // Upsert keeps one row per user+post, bumping visitedAt so the history
  // card reflects "most recently viewed" order.
  await prisma.postVisit.upsert({
    create: {
      postId: body.postId,
      userId: session.user.id,
    },
    update: { visitedAt: new Date() },
    where: {
      userId_postId: {
        postId: body.postId,
        userId: session.user.id,
      },
    },
  });

  return Response.json({ success: true });
}
