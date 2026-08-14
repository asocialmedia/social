import { searchPosts, searchUsers } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
