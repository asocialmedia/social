import { getPostDataInclude, type PostsPage, prisma } from "@asm/db";
import type { NextRequest } from "next/server";
import { getSessionFromApi } from "@/lib/session";

const searchSuggestionsCache = {
  addToHistory(_userId: string, _query: string) {
    return;
  },
  addSuggestion(_query: string) {
    return;
  },
  removeHistoryItem(_userId: string, _query: string) {
    return;
  },
  clearHistory(_userId: string) {
    return;
  },
};

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 10;

  const posts = await prisma.post.findMany({
    where: {
      content: { contains: q, mode: "insensitive" },
    },
    include: getPostDataInclude(user.id),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    cursor: cursor ? { id: cursor } : undefined,
  });

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const data: PostsPage = {
    posts: posts.slice(0, pageSize),
    nextCursor,
  };
  return Response.json(data);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { query } = await req.json();
    if (!query) {
      return Response.json({ error: "Query is required" }, { status: 400 });
    }

    await Promise.all([
      searchSuggestionsCache.addToHistory(user.id, query),
      searchSuggestionsCache.addSuggestion(query),
    ]);

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error in search API:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const type = searchParams.get("type");
    const query = searchParams.get("query");

    if (type !== "history") {
      return Response.json({ error: "Invalid operation" }, { status: 400 });
    }

    if (query) {
      await searchSuggestionsCache.removeHistoryItem(user.id, query);
    } else {
      await searchSuggestionsCache.clearHistory(user.id);
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error in search API:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
