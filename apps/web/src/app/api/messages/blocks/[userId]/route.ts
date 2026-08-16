import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ userId: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await ctx.params;
  await prisma.block.deleteMany({
    where: { blockedId: userId, blockerId: user.id },
  });

  return Response.json({ ok: true });
}
