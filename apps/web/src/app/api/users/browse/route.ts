import { getUserDataSelect, prisma, SYSTEM_MODERATION_USER_ID } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

type UserOrderBy =
  | { createdAt: "asc" }
  | { createdAt: "desc" }
  | { followers: { _count: "desc" } }
  | { posts: { _count: "desc" } };

export async function GET(request: Request) {
  try {
    // Guests can browse users; per-user fields simply resolve to empty.
    const session = await getSessionFromApi();
    const viewerId = session?.user?.id ?? "";

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const sortBy = searchParams.get("sortBy") || "followers";

    let orderBy: UserOrderBy = { followers: { _count: "desc" } };

    switch (sortBy) {
      case "followers": {
        orderBy = {
          followers: {
            _count: "desc",
          },
        };
        break;
      }
      case "posts": {
        orderBy = {
          posts: {
            _count: "desc",
          },
        };
        break;
      }
      case "newest": {
        orderBy = {
          createdAt: "desc",
        };
        break;
      }
      case "oldest": {
        orderBy = {
          createdAt: "asc",
        };
        break;
      }
      default: {
        orderBy = {
          followers: {
            _count: "desc",
          },
        };
      }
    }

    const users = await prisma.user.findMany({
      orderBy,
      select: getUserDataSelect(viewerId),
      take: 20,
      where: {
        AND: [
          {
            id: {
              not: viewerId,
            },
          },
          { id: { not: SYSTEM_MODERATION_USER_ID } },
          {
            OR: [
              {
                username: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                displayName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            ],
          },
        ],
      },
    });

    return Response.json(users);
  } catch {
    return Response.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
