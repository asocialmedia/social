import { prisma } from "@asm/db";
import { connection } from "next/server";

export async function GET(request: Request) {
  // Public user search; no account needed. Search results must never be baked
  // into a prerendered response, and the claim also keeps the Prisma read out
  // of the prerender: Prisma 8 stamps each query with a crypto.randomUUID()
  // plan id, and Cache Components fails a prerender that touches an uncached
  // value.
  await connection();

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const pattern = `%${q}%`;
  const [usernameResults, displayNameResults] = await Promise.all([
    prisma.orm.public.Users.select("avatarUrl", "displayName", "id", "username")
      .where((user) => user.username.ilike(pattern))
      .limit(10)
      .all(),
    prisma.orm.public.Users.select("avatarUrl", "displayName", "id", "username")
      .where((user) => user.displayName.ilike(pattern))
      .limit(10)
      .all(),
  ]);
  const results = [...usernameResults, ...displayNameResults]
    .filter(
      (user, index, all) =>
        all.findIndex((candidate) => candidate.id === user.id) === index
    )
    .slice(0, 10);
  return Response.json({ users: results });
}
