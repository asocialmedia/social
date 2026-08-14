import { prisma, tagCache } from "@asm/db";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/session";

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

    const post = await prisma.post.findUnique({
      include: {
        tags: true,
        user: true,
      },
      where: { id: postId },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.user.id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.post.update({
      data: {
        tags: {
          disconnect: post.tags.map((tag) => ({ id: tag.id })),
        },
      },
      where: { id: postId },
    });

    const normalizedTags = tags.map((tag: string) => tag.toLowerCase());

    const updatedPost = await prisma.post.update({
      data: {
        tags: {
          connectOrCreate: normalizedTags.map((tag: string) => ({
            create: { name: tag },
            where: { name: tag },
          })),
        },
      },
      include: {
        tags: {
          include: {
            _count: {
              select: {
                posts: true,
              },
            },
          },
        },
      },
      where: { id: postId },
    });

    await Promise.all(
      normalizedTags.map((tag: string) => tagCache.incrementTagCount(tag))
    );

    return NextResponse.json({ tags: updatedPost.tags });
  } catch (error) {
    console.error("Error updating post tags:", error);
    return NextResponse.json(
      { error: "Failed to update tags" },
      { status: 500 }
    );
  }
}
