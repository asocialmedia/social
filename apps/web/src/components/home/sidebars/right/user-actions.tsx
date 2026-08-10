"use server";

import { Prisma, prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function getSuggestedConnections() {
  try {
    const session = await getSessionFromApi();

    if (!session?.user) {
      throw new Error("User not authenticated");
    }

    const suggestedUsers = await prisma.user.findMany({
      where: {
        NOT: {
          OR: [
            { id: session.user.id },
            {
              followers: {
                some: {
                  followerId: session.user.id,
                },
              },
            },
          ],
        },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        aura: true,
        _count: {
          select: {
            followers: true,
          },
        },
      },
      orderBy: [
        ...(Math.random() > 0.3
          ? [{ aura: Prisma.SortOrder.desc }]
          : [
              {
                followers: {
                  _count: Prisma.SortOrder.desc,
                },
              },
            ]),
      ],
      take: 10,
    });

    const shuffled = suggestedUsers.sort(() => Math.random() - 0.5).slice(0, 5);

    return JSON.parse(JSON.stringify(shuffled));
  } catch (error) {
    console.error("Error in getSuggestedConnections:", error);
    throw new Error("Failed to fetch suggested connections", { cause: error });
  }
}
