import { getUserDataSelect, prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  try {
    const session = await getSessionFromApi();
    const userId = session?.user?.id;

    const trendingUsers = await prisma.user.findMany({
      take: 6,
      where: {
        id: {
          not: userId || undefined,
        },
      },
      orderBy: [
        {
          followers: {
            _count: "desc",
          },
        },
        {
          posts: {
            _count: "desc",
          },
        },
      ],
      select: getUserDataSelect(userId || ""),
    });

    return Response.json(trendingUsers);
  } catch {
    return Response.json(
      { error: "Failed to fetch trending users" },
      { status: 500 }
    );
  }
}
