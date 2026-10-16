import {
  getUserDataQuery,
  getUserProfileSummary,
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

    const summary = await getUserProfileSummary(
      prisma.orm,
      resolvedUsername.id,
      viewerId
    );
    return Response.json({ ...user, ...summary });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
