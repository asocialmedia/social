import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

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

    const bookmark = await prisma.hNBookmark.findUnique({
      where: {
        userId_storyId: {
          storyId: Math.trunc(Number(storyId)),
          userId: loggedInUser.id,
        },
      },
    });

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
  await prisma.hNBookmark.create({
    data: { storyId: Number(storyId), userId: user.id },
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
  await prisma.hNBookmark.deleteMany({
    where: { storyId: Number(storyId), userId: user.id },
  });
  return Response.json({ success: true });
}
