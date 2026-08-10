import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const bookmarks = await prisma.hNBookmark.findMany({
    where: { userId: user.id },
  });
  return Response.json(bookmarks);
}
