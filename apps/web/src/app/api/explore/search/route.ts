import {
  getPostDataInclude,
  getUserDataSelect,
  hydrateViewCounts,
  prisma,
} from "@asm/db";
import type { Prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

const TAKE_PATTERN = /^[1-9]\d*$/;

export async function GET(request: Request) {
  // Guests can explore; per-user fields simply resolve to empty.
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tabParam = url.searchParams.get("tab");
  let tab: "for-you" | "people" | "trending" | "gusts" = "for-you";
  if (tabParam === "trending") {
    tab = "trending";
  } else if (tabParam === "gusts") {
    tab = "gusts";
  } else if (tabParam === "people") {
    tab = "people";
  }

  const takeValue = url.searchParams.get("take");
  const requestedTake =
    takeValue && TAKE_PATTERN.test(takeValue)
      ? Math.trunc(Number(takeValue))
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

  // Tags (post and media) are stored lowercased (connectOrCreate lowercases
  // on write), so the exact-match `has` predicate needs the normalized form;
  // `contains` predicates are case-insensitive and use the raw query.
  const lowerQ = q.toLowerCase();

  const searchFilter: Prisma.PostWhereInput = {
    OR: [
      { content: { contains: q, mode: "insensitive" } },
      { tags: { some: { name: { contains: q, mode: "insensitive" } } } },
      { semanticTags: { has: lowerQ } },
      {
        attachments: {
          some: {
            OR: [
              { transcript: { contains: q, mode: "insensitive" } },
              { ocrText: { contains: q, mode: "insensitive" } },
              { semanticTags: { has: lowerQ } },
            ],
          },
        },
      },
    ],
  };

  const postWhere: Prisma.PostWhereInput =
    tab === "gusts"
      ? {
          ...searchFilter,
          isGust: true,
          // Moderated posts are hidden from explore entirely.
          moderated: false,
        }
      : { ...searchFilter, moderated: false };

  const [rawPosts, users] = await Promise.all([
    prisma.post.findMany({
      include: getPostDataInclude(userId),
      orderBy: postOrderBy,
      take: pageSize,
      where: postWhere,
    }),
    prisma.user.findMany({
      orderBy: { aura: "desc" },
      select: getUserDataSelect(userId),
      take: pageSize,
      where: {
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
          { displayUsername: { contains: q, mode: "insensitive" } },
        ],
      },
    }),
  ]);

  const posts = await hydrateViewCounts(rawPosts);

  return Response.json({ posts, users });
}
