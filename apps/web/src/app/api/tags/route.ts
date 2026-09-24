import { prisma, tagCache } from "@asm/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.toLowerCase();

    let tags: string[] = [];

    if (query) {
      tags = await tagCache.searchTags(query);

      if (!tags || tags.length === 0) {
        const dbTags = await prisma.orm.public.Tag.select("name")
          .where((tag) => tag.name.ilike(`%${query}%`))
          .orderBy((tag) => tag.name.asc())
          .limit(10)
          .all();
        tags = dbTags.map((t) => t.name);
      }

      if (!tags.includes(query)) {
        tags.unshift(query);
      }
    } else {
      const popularTags = await tagCache.getPopularTags(10);
      tags = popularTags.map((t) => t.name);
    }

    return NextResponse.json({ tags });
  } catch (error) {
    console.error("Error fetching tags:", error);
    return NextResponse.json({ tags: [] });
  }
}
