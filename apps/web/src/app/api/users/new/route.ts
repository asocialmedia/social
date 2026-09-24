import {
  getUserDataQuery,
  mapUserData,
  prisma,
  SYSTEM_MODERATION_USER_ID,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userRows = await getUserDataQuery(prisma.orm, user.id)
    .where((candidate) => candidate.id.neq(SYSTEM_MODERATION_USER_ID))
    .orderBy((candidate) => candidate.createdAt.desc())
    .limit(10)
    .all();
  const users = userRows.map(mapUserData);
  return Response.json(users);
}
