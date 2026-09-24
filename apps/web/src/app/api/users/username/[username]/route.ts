import {
  getUserDataQuery,
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
    const loggedInUser = session?.user;

    if (!loggedInUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedUsername = await resolveUsername(username);
    if (!resolvedUsername) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const userRow = await getUserDataQuery(prisma.orm, loggedInUser.id)
      .where({ id: resolvedUsername.id })
      .first();
    const user = userRow ? mapUserData(userRow) : null;

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json(user);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
