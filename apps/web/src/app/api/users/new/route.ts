import { getUserDataSelect, prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const users = await prisma.user.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    select: getUserDataSelect(user.id),
  });
  return Response.json(users);
}
