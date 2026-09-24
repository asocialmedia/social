import { prisma, toPrismaDateTime } from "@asm/db";

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

  await prisma.orm.public.PostVisits.upsert({
    conflictOn: { postId, userId },
    create: { postId, userId },
    update: { visitedAt: toPrismaDateTime(new Date()) },
  });

  return Response.json({ success: true });
}
