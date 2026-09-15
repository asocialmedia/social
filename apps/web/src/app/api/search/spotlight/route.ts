import { searchCommunitiesForSearch, searchPosts, searchUsers } from "@asm/db";

export async function GET(request: Request) {
  // Public search popup; no account needed.
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    Math.max(Math.trunc(Number(url.searchParams.get("limit") ?? "6")), 1),
    20
  );

  if (!q) {
    return Response.json({ communities: [], posts: [], users: [] });
  }

  const [users, posts, communities] = await Promise.all([
    searchUsers(q, limit),
    searchPosts(q, limit),
    searchCommunitiesForSearch(q, limit),
  ]);

  return Response.json({ communities, posts, users });
}
