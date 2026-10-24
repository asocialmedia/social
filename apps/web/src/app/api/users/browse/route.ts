import {
  and,
  fromPrismaDateTime,
  getUserDataQuery,
  mapUserData,
  prisma,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  safeUserDiscoveryResponse,
  userFollowerCounts,
} from "@/lib/users/discovery-safety";

export async function GET(request: Request) {
  return safeUserDiscoveryResponse(await readUsers(request));
}

async function readUsers(request: Request) {
  try {
    // Guests can browse users; per-user fields simply resolve to empty.
    const session = await getSessionFromApi();
    const viewerId = session?.user?.id ?? "";

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const sortBy = searchParams.get("sortBy") || "followers";

    const pattern = `%${search.replaceAll(/[\\%_]/g, "\\$&")}%`;
    const [usernameRows, displayNameRows] = await Promise.all([
      getUserDataQuery(prisma.orm, viewerId)
        .where((user) =>
          and(
            user.id.neq(viewerId),
            user.id.neq(SYSTEM_MODERATION_USER_ID),
            user.username.ilike(pattern)
          )
        )
        .include("follows", (follows) =>
          follows.combine({ total: follows.count() })
        )
        .include("followsFollows", (follows) =>
          follows.combine({ total: follows.count() })
        )
        .include("posts", (posts) => posts.combine({ total: posts.count() }))
        .all(),
      getUserDataQuery(prisma.orm, viewerId)
        .where((user) =>
          and(
            user.id.neq(viewerId),
            user.id.neq(SYSTEM_MODERATION_USER_ID),
            user.displayName.ilike(pattern)
          )
        )
        .include("follows", (follows) =>
          follows.combine({ total: follows.count() })
        )
        .include("followsFollows", (follows) =>
          follows.combine({ total: follows.count() })
        )
        .include("posts", (posts) => posts.combine({ total: posts.count() }))
        .all(),
    ]);
    const rows = [...usernameRows, ...displayNameRows].filter(
      (row, index, allRows) =>
        allRows.findIndex((candidate) => candidate.id === row.id) === index
    );
    const followerCounts = await userFollowerCounts();
    rows.sort((left, right) => {
      if (sortBy === "newest") {
        return (
          fromPrismaDateTime(right.createdAt).getTime() -
          fromPrismaDateTime(left.createdAt).getTime()
        );
      }
      if (sortBy === "oldest") {
        return (
          fromPrismaDateTime(left.createdAt).getTime() -
          fromPrismaDateTime(right.createdAt).getTime()
        );
      }
      if (sortBy === "posts") {
        return right.posts.total - left.posts.total;
      }
      return (
        (followerCounts.get(right.id) ?? 0) - (followerCounts.get(left.id) ?? 0)
      );
    });
    const users = rows.slice(0, 20).map((user) => ({
      ...mapUserData(user),
      _count: {
        followers: followerCounts.get(user.id) ?? 0,
        following: user.follows.total,
      },
    }));

    return Response.json(users);
  } catch {
    return Response.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
