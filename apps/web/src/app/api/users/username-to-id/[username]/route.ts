import { resolveUsername } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ username: string }> }
) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { username } = await ctx.params;
  const resolvedUsername = await resolveUsername(username);
  if (!resolvedUsername) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  return Response.json({
    id: resolvedUsername.id,
    username: resolvedUsername.username,
  });
}
