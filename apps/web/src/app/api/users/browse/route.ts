import { getUserDataSelect, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

type UserOrderBy =
  | { createdAt: "asc" }
  | { createdAt: "desc" }
  | { followers: { _count: "desc" } }
  | { posts: { _count: "desc" } };

export async function GET(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

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
      select: getUserDataSelect(user.id),
      take: 20,
      where: {
        AND: [
          {
            id: {
              not: user.id,
            },
          },
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
