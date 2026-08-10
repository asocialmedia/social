import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const posts = await prisma.bookmark.findMany({
    where: { userId: user.id },
    include: { post: true },
  });
  return Response.json(posts);
}
