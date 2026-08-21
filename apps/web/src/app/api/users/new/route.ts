import { getUserDataSelect, prisma, SYSTEM_MODERATION_USER_ID } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: getUserDataSelect(user.id),
    take: 10,
    where: { id: { not: SYSTEM_MODERATION_USER_ID } },
  });
  return Response.json(users);
}
