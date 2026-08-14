import {
  getPostDataInclude,
  hydrateViewCounts,
  prisma,
  searchSuggestionsCache,
} from "@asm/db";
import type { PostsPage } from "@asm/db";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  if (type === "history") {
    const history = await searchSuggestionsCache.getHistory(user.id);
    return Response.json(history);
  }

  if (type === "suggestions") {
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (!q) {
      return Response.json([]);
    }
    const suggestions = await searchSuggestionsCache.getSuggestions(q, 5);
    return Response.json(suggestions);
  }

  const q = url.searchParams.get("q") || "";
  const cursor = url.searchParams.get("cursor") || undefined;
  const pageSize = 10;

  const posts = await prisma.post.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: getPostDataInclude(user.id),
    orderBy: { createdAt: "desc" },
    take: pageSize + 1,
    where: {
      content: { contains: q, mode: "insensitive" },
    },
  });

  const nextCursor = posts.length > pageSize ? posts[pageSize].id : null;
  const hydrated = await hydrateViewCounts(posts.slice(0, pageSize));
  const data: PostsPage = {
    nextCursor,
    posts: hydrated,
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

    const { searchParams } = req.nextUrl;
    const type = searchParams.get("type");
    const query = searchParams.get("query");

    if (type !== "history") {
      return Response.json({ error: "Invalid operation" }, { status: 400 });
    }

    await (query
      ? searchSuggestionsCache.removeHistoryItem(user.id, query)
      : searchSuggestionsCache.clearHistory(user.id));

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error in search API:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
