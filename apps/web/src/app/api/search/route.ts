import {
  and,
  communityVisibilityWhere,
  getClientIpFromRequest,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
  searchSuggestionsCache,
} from "@asm/db";
import type { PostsPage } from "@asm/db";
import type { NextRequest } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  if (type === "history") {
    // Search history is per-user; guests have none.
    if (!user) {
      return Response.json([]);
    }
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

  // Guests can search public posts; per-user fields simply resolve to empty.
  // Moderated posts are excluded at the DB query — never returned to the client.
  const pattern = `%${q.replaceAll(/[\\%_]/g, "\\$&")}%`;
  let query = getPostDataQuery(prisma.orm, user?.id ?? "")
    .where((post) =>
      and(
        post.moderated.eq(false),
        post.content.ilike(pattern),
        communityVisibilityWhere(user?.id ?? "")(post)
      )
    )
    .orderBy((post) => post.createdAt.desc());
  if (cursor) {
    query = query.cursor({ id: cursor }).offset(1);
  }
  const postRows = await query.limit(pageSize + 1).all();
  const posts = postRows.map(mapPostData);

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

    const body = await req.json();
    const {
      post: searchedPost,
      query,
      resultCount,
      type: itemType,
      user: searchedUser,
    } = body;

    if (!query && !searchedUser && !searchedPost) {
      return Response.json(
        { error: "Query, user, or post is required" },
        { status: 400 }
      );
    }

    const clientId = user?.id || getClientIpFromRequest(req);
    const hasResults = typeof resultCount !== "number" || resultCount > 0;

    // Guests still contribute to global suggestions, just not personal history.
    // Quality check: queries with 0 results are not promoted to global suggestions.
    if (!user) {
      if (query && typeof query === "string" && hasResults) {
        await searchSuggestionsCache.addSuggestion(query, { clientId });
      }
      return Response.json({ success: true });
    }

    if (searchedUser || itemType === "user") {
      const userPayload = searchedUser || body.data;
      if (userPayload) {
        await searchSuggestionsCache.addUserToHistory(user.id, userPayload);
        const name = userPayload.displayName || userPayload.username;
        if (name) {
          await searchSuggestionsCache.addSuggestion(name, { clientId });
        }
      }
    } else if (searchedPost || itemType === "post") {
      const postPayload = searchedPost || body.data;
      if (postPayload) {
        await searchSuggestionsCache.addPostToHistory(user.id, postPayload);
      }
    } else if (query && typeof query === "string") {
      const promises: Promise<unknown>[] = [
        searchSuggestionsCache.addToHistory(user.id, query, resultCount),
      ];
      if (hasResults) {
        promises.push(
          searchSuggestionsCache.addSuggestion(query, { clientId })
        );
      }
      await Promise.all(promises);
    }

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
    const target =
      searchParams.get("target") ||
      searchParams.get("query") ||
      searchParams.get("id");

    if (type !== "history") {
      return Response.json({ error: "Invalid operation" }, { status: 400 });
    }

    await (target
      ? searchSuggestionsCache.removeHistoryItem(user.id, target)
      : searchSuggestionsCache.clearHistory(user.id));

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error in search API:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
