import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const [postsWithTags, tagCounts] = await Promise.all([
      prisma.orm.public.Posts.select("content", "id")
        .include("postToTags", (postTag) =>
          postTag.include("tag", (tag) => tag.select("id", "name"))
        )
        .where((post) => post.rootPostId.isNull())
        .all(),
      prisma.orm.public.PostToTag.where((postTag) =>
        postTag.posts.some((post) => post.rootPostId.isNull())
      )
        .groupBy("b")
        .aggregate((aggregate) => ({ count: aggregate.count() })),
    ]);
    const counts = new Map(tagCounts.map((row) => [row.b, row.count]));
    const posts = postsWithTags.map((post) => ({
      content: post.content,
      id: post.id,
      tags: post.postToTags.flatMap((postTag) =>
        postTag.tag
          ? [
              {
                _count: { posts: counts.get(postTag.tag.id) ?? 0 },
                id: postTag.tag.id,
                name: postTag.tag.name,
              },
            ]
          : []
      ),
    }));

    return NextResponse.json({ posts });
  } catch (error) {
    console.error("Error fetching posts with tags:", error);
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}
