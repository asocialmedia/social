import { prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";

export async function POST() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.notification.updateMany({
    where: { recipientId: user.id, read: false },
    data: { read: true },
  });
  return Response.json({ success: true });
}
