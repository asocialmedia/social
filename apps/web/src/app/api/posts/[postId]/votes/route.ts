import { getPostDataInclude, type PostData, prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

interface VoteInfo {
  aura: number;
  userVote: number;
}

export async function GET(
  _req: Request,
  props: { params: Promise<{ postId: string }> }
) {
  const params = await props.params;
  const { postId } = params;

  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: getPostDataInclude(user.id),
    });

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    const voteInfo: VoteInfo = {
      aura: post.aura,
      userVote: post.vote[0]?.value || 0,
    };

    const postData: PostData & VoteInfo = {
      ...post,
      ...voteInfo,
    };

    return Response.json(postData);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { value } = await request.json();

  if (typeof value !== "number" || value === 0) {
    await prisma.vote.deleteMany({ where: { userId: user.id, postId } });
  } else {
    await prisma.vote.upsert({
      where: { userId_postId: { userId: user.id, postId } },
      create: { userId: user.id, postId, value },
      update: { value },
    });
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: getPostDataInclude(user.id),
  });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const voteInfo: VoteInfo = {
    aura: post.aura,
    userVote: post.vote[0]?.value || 0,
  };

  return Response.json(voteInfo);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.vote.deleteMany({ where: { userId: user.id, postId } });

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: getPostDataInclude(user.id),
  });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  const voteInfo: VoteInfo = {
    aura: post.aura,
    userVote: 0,
  };

  return Response.json(voteInfo);
}
