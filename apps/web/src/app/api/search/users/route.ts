import { prisma } from "@asm/db";

export async function GET(request: Request) {
  // Public user search; no account needed.
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
