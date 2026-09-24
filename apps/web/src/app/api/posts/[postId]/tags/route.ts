import { prisma, tagCache } from "@asm/db";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";

async function createPostTags(
  postId: string,
  tags: string[],
  index = 0
): Promise<void> {
  const tagName = tags[index];
  if (tagName === undefined) {
    return;
  }
  let tag = await prisma.orm.public.Tag.select("id")
    .where({ name: tagName })
    .first();
  if (!tag) {
    tag = await prisma.orm.public.Tag.create({ name: tagName });
  }
  await prisma.orm.public.PostToTag.create({ a: postId, b: tag.id });
  return createPostTags(postId, tags, index + 1);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ postId: string }> }
) {
  try {
    const [session, params] = await Promise.all([
      getSessionFromApi(),
      context.params,
    ]);

    const user = session?.user;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { postId } = params;
    if (!postId) {
      return NextResponse.json(
        { error: "Post ID is required" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { tags } = body;

    const post = await prisma.orm.public.Posts.select("id", "userId")
      .include("postToTags", (postTag) =>
        postTag.include("tag", (tag) => tag.select("id", "name"))
      )
      .where({ id: postId })
      .first();

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.userId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.orm.public.PostToTag.where({ a: postId }).delete();

    const normalizedTags = tags.map((tag: string) => tag.toLowerCase());

    await createPostTags(postId, normalizedTags);

    const updatedPost = await prisma.orm.public.Posts.select("id")
      .include("postToTags", (postTag) =>
        postTag.include("tag", (tag) =>
          tag
            .select("id", "name")
            .include("postToTags", (postTags) =>
              postTags.combine({ total: postTags.count() })
            )
        )
      )
      .where({ id: postId })
      .first();
    const updatedTags =
      updatedPost?.postToTags.flatMap((postTag) =>
        postTag.tag
          ? [
              {
                _count: { posts: postTag.tag.postToTags.total },
                id: postTag.tag.id,
                name: postTag.tag.name,
              },
            ]
          : []
      ) ?? [];

    await Promise.all(
      normalizedTags.map((tag: string) => tagCache.incrementTagCount(tag))
    );

    return NextResponse.json({ tags: updatedTags });
  } catch (error) {
    console.error("Error updating post tags:", error);
    return NextResponse.json(
      { error: "Failed to update tags" },
      { status: 500 }
    );
  }
}
