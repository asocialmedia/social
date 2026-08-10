import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const { userId } = await ctx.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user || user.id !== userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  await prisma.user.update({ where: { id: user.id }, data: body });
  return Response.json({ success: true });
}
