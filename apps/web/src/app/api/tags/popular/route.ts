import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const tags = await prisma.orm.public.Tag.select("id", "name")
      .include("postToTags", (postTags) =>
        postTags.combine({ total: postTags.count() })
      )
      .all();

    const popularTags = tags
      .filter((tag) => tag.postToTags.total > 0)
      .toSorted((left, right) => right.postToTags.total - left.postToTags.total)
      .slice(0, 10)
      .map((tag) => ({
        _count: { posts: tag.postToTags.total },
        id: tag.id,
        name: tag.name,
      }));

    return NextResponse.json({ tags: popularTags });
  } catch (error) {
    console.error("Error fetching popular tags:", error);
    return NextResponse.json({ tags: [] }, { status: 500 });
  }
}
