import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

export async function POST() {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.orm.public.Accounts.where({
    providerId: "bluesky",
    userId: session.user.id,
  }).deleteAndCount();

  return Response.json({ ok: true });
}
