import { prisma } from "@asm/db";

export async function GET(request: Request) {
  // Public user search; no account needed.
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const results = await prisma.user.findMany({
    select: { avatarUrl: true, displayName: true, id: true, username: true },
    take: 10,
    where: {
      OR: [
        { username: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ],
    },
  });
  return Response.json({ users: results });
}
