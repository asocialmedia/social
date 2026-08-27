import { prisma, redis } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/session";

const logger = createLogger({ serviceName: "api-suggested-dismiss" });

const RECENTLY_SHOWN_CACHE_KEY = (userId: string) =>
  `recently-shown-users:${userId}`;
const RECENTLY_SHOWN_TTL = 3600;

export async function POST(req: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { userId?: string };
    const targetId = body.userId;
    if (!targetId || typeof targetId !== "string") {
      return Response.json({ error: "userId required" }, { status: 400 });
    }
    // Verify target exists and is not self
    if (targetId === user.id) {
      return Response.json(
        { error: "Cannot dismiss yourself" },
        { status: 400 }
      );
    }
    const exists = await prisma.user.findUnique({
      select: { id: true },
      where: { id: targetId },
    });
    if (!exists) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    const key = RECENTLY_SHOWN_CACHE_KEY(user.id);
    await redis.sadd(key, targetId);
    await redis.expire(key, RECENTLY_SHOWN_TTL);
    logger.info(
      { dismissed: targetId, userId: user.id },
      "dismissed suggestion"
    );
    return Response.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, "dismiss failed");
    return Response.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
