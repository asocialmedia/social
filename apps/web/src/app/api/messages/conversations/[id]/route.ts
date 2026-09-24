import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { getConversationForUser } from "@/lib/messages/server";

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
    prisma.orm.public.MessageConversationKeys.select(
      "encryptedKey",
      "iv",
      "ownerUserId"
    )
      .where({ conversationId: id })
      .all(),
    prisma.orm.public.Messages.where((message) =>
      and(message.conversationId.eq(id), message.senderId.eq(user.id))
    ).aggregate((aggregate) => ({ count: aggregate.count() })),
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
    mySentCount: mySentCount.count,
  });
}
