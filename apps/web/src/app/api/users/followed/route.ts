import { getUserDataQuery, mapUserData, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const followed = await prisma.orm.public.Follows.include(
    "following",
    (_following) => getUserDataQuery(prisma.orm, userId)
  )
    .where({ followerId: userId })
    .all();

  return Response.json(
    followed.flatMap((follow) =>
      follow.following ? [mapUserData(follow.following)] : []
    )
  );
}
