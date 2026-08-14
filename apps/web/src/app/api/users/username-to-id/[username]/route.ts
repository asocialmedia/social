import { getSessionFromApi } from "@/lib/session";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ username: string }> }
) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { username } = await ctx.params;
  return Response.json({ id: session.user.id, username });
}
