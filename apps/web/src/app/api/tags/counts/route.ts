import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const postsWithTags = await prisma.post.findMany({
      select: {
        content: true,
        id: true,
        tags: {
          select: {
            _count: {
              select: {
                // Count top-level posts only so responses do not inflate tags.
                posts: { where: { rootPostId: null } },
              },
            },
            id: true,
            name: true,
          },
        },
      },
      where: { rootPostId: null },
    });

    return NextResponse.json({ posts: postsWithTags });
  } catch (error) {
    console.error("Error fetching posts with tags:", error);
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}
