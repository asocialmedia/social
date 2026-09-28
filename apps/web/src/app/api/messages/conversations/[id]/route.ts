import { prisma } from "@asm/db";

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
    prisma.messageConversationKey.findMany({
      where: { conversationId: id },
    }),
    prisma.message.count({
      where: { conversationId: id, senderId: user.id },
    }),
  ]);

  // The caller's own preferences, lifted out of the member list so the client
  // never has to pick "my" row out of a two-element array. The conversation
  // payload still carries every member row (the thread reads the peer's), so
  // this is a convenience read, not a privacy boundary.
  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );

  return Response.json({
    conversation,
    keys: keys.map((key) => ({
      encryptedKey: {
        ciphertext: key.encryptedKey,
        iv: key.iv,
      },
      ownerUserId: key.ownerUserId,
      version: key.version,
    })),
    mySentCount,
    prefs: {
      mutedAt: myMember?.mutedAt?.toISOString() ?? null,
      themeKey: myMember?.themeKey ?? null,
    },
  });
}
