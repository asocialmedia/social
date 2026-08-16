import { searchPosts, searchUsers } from "@asm/db";

export async function GET(request: Request) {
  // Public search popup; no account needed.
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    Math.max(Math.trunc(Number(url.searchParams.get("limit") ?? "6")), 1),
    20
  );

  if (!q) {
    return Response.json({ posts: [], users: [] });
  }

  const [users, posts] = await Promise.all([
    searchUsers(q, limit),
    searchPosts(q, limit),
  ]);

  return Response.json({ posts, users });
}
