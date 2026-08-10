import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const mentions = await prisma.mention.findMany({
    where: { userId: session.user.id },
  });
  return Response.json(mentions);
}
