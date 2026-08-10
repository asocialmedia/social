import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const posts = await prisma.post.findMany({
    where: { user: { followers: { some: { followerId: user.id } } } },
    orderBy: { createdAt: "desc" },
    include: { _count: true },
  });
  return Response.json(posts);
}
