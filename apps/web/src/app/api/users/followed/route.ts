import { getUserDataSelect, prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const followed = await prisma.follow.findMany({
    where: { followerId: userId },
    select: { following: { select: getUserDataSelect(userId) } },
  });

  return Response.json(
    followed.map((f) => (f as { following: unknown }).following)
  );
}
