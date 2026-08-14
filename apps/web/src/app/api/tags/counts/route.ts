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
                posts: true,
              },
            },
            id: true,
            name: true,
          },
        },
      },
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
