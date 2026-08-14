import { prisma } from "@asm/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const tags = await prisma.tag.findMany({
      orderBy: {
        posts: {
          _count: "desc",
        },
      },
      select: {
        _count: {
          select: {
            posts: true,
          },
        },
        id: true,
        name: true,
      },
      take: 10,
      where: {
        posts: {
          some: {},
        },
      },
    });

    return NextResponse.json({ tags });
  } catch (error) {
    console.error("Error fetching popular tags:", error);
    return NextResponse.json({ tags: [] }, { status: 500 });
  }
}
