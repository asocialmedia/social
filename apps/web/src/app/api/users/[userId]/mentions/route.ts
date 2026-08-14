import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId } = await ctx.params;
  const mentions = await prisma.mention.findMany({
    where: { userId },
  });
  return Response.json(mentions);
}
