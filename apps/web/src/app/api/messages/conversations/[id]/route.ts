import { prisma } from "@asm/db";

import { getConversationForUser } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const [keys, mySentCount] = await Promise.all([
    prisma.messageConversationKey.findMany({
      where: { conversationId: id },
    }),
    prisma.message.count({
      where: { conversationId: id, senderId: user.id },
    }),
  ]);

  return Response.json({
    conversation,
    keys: keys.map((key) => ({
      encryptedKey: {
        ciphertext: key.encryptedKey,
        iv: key.iv,
      },
      ownerUserId: key.ownerUserId,
    })),
    mySentCount,
  });
}
