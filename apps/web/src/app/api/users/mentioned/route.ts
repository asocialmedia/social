import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const mentions = await prisma.orm.public.Mentions.where({
    userId: session.user.id,
  }).all();
  return Response.json(mentions);
}
