import { searchCommunitiesForSearch, searchPosts, searchUsers } from "@asm/db";
import { connection } from "next/server";

export async function GET(request: Request) {
  // Public search popup; no account needed. Search results must never be baked
  // into a prerendered response, and the claim also keeps the Prisma reads out
  // of the prerender: Prisma 8 stamps each query with a crypto.randomUUID()
  // plan id, and Cache Components fails a prerender that touches an uncached
  // value.
  await connection();

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
