import {
  getUserDataQuery,
  getUserProfileCounts,
  mapUserData,
  prisma,
  resolveUsername,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(
  _req: Request,
  props: { params: Promise<{ username: string }> }
) {
  const params = await props.params;

  const { username } = params;

  try {
    const session = await getSessionFromApi();
    const viewerId = session?.user?.id ?? "";

    const resolvedUsername = await resolveUsername(username);
    if (!resolvedUsername) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const userRow = await getUserDataQuery(prisma.orm, viewerId)
      .where({ id: resolvedUsername.id })
      .first();
    const user = userRow ? mapUserData(userRow) : null;

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const counts = await getUserProfileCounts(prisma.orm, resolvedUsername.id);
    return Response.json({ ...user, _count: counts });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
