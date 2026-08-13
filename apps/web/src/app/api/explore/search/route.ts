import {
  getPostDataInclude,
  getUserDataSelect,
  hydrateViewCounts,
  type Prisma,
  prisma,
} from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

const TAKE_PATTERN = /^[1-9]\d*$/;

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tab =
    url.searchParams.get("tab") === "trending" ? "trending" : "for-you";

  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Number.parseInt(takeValue, 10)
      : 0;
  const pageSize = requestedTake > 0 ? Math.min(requestedTake, 20) : 20;

  if (!q) {
    return Response.json({ posts: [], users: [] });
  }

  const postOrderBy:
    | Prisma.PostOrderByWithRelationInput
    | Prisma.PostOrderByWithRelationInput[] =
    tab === "trending"
      ? [{ aura: "desc" }, { id: "desc" }]
      : { createdAt: "desc" };
  const [rawPosts, users] = await Promise.all([
    prisma.post.findMany({
      where: { content: { contains: q, mode: "insensitive" } },
      include: getPostDataInclude(userId),
      orderBy: postOrderBy,
      take: pageSize,
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
          { displayUsername: { contains: q, mode: "insensitive" } },
        ],
      },
      select: getUserDataSelect(userId),
      orderBy: { aura: "desc" },
      take: pageSize,
    }),
  ]);

  const posts = await hydrateViewCounts(rawPosts);

  return Response.json({ posts, users });
}
