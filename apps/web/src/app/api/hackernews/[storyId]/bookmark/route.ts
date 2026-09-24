import { randomUUID } from "node:crypto";

import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(
  _req: Request,
  props: { params: Promise<{ storyId: string }> }
) {
  const params = await props.params;
  const { storyId } = params;

  try {
    const sessionResponse = await getSessionFromApi();

    if (!sessionResponse?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loggedInUser = sessionResponse.user;

    const bookmark = await prisma.orm.public.HNBookmark.where((candidate) =>
      and(
        candidate.storyId.eq(Math.trunc(Number(storyId))),
        candidate.userId.eq(loggedInUser.id)
      )
    ).first();

    return Response.json({ isBookmarked: !!bookmark });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ storyId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { storyId } = await ctx.params;
  await prisma.orm.public.HNBookmark.create({
    id: randomUUID(),
    storyId: Math.trunc(Number(storyId)),
    userId: user.id,
  });
  return Response.json({ success: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ storyId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { storyId } = await ctx.params;
  await prisma.orm.public.HNBookmark.where((bookmark) =>
    and(
      bookmark.storyId.eq(Math.trunc(Number(storyId))),
      bookmark.userId.eq(user.id)
    )
  ).delete();
  return Response.json({ success: true });
}
