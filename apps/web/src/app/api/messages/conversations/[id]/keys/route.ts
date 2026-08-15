import { prisma } from "@asm/db";

import { getConversationForUser } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

export interface WrappedKeyPayload {
  encryptedKey: {
    ciphertext: string;
    iv: string;
  };
  ownerUserId: string;
}

export async function POST(
  request: Request,
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

  const body = (await request.json()) as { keys?: WrappedKeyPayload[] };
  const { keys } = body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return Response.json({ error: "keys are required" }, { status: 400 });
  }

  // The caller (the conversation creator) must wrap the root key for every
  // member. Validate each owner is a member and every payload is well-formed.
  const memberIds = new Set(
    conversation.members.map((member) => member.userId)
  );
  for (const key of keys) {
    if (
      typeof key.ownerUserId !== "string" ||
      !memberIds.has(key.ownerUserId) ||
      typeof key.encryptedKey?.ciphertext !== "string" ||
      typeof key.encryptedKey?.iv !== "string"
    ) {
      return Response.json({ error: "Invalid key payload" }, { status: 400 });
    }
  }

  await prisma.$transaction(
    keys.map((key) =>
      prisma.messageConversationKey.upsert({
        create: {
          conversationId: id,
          encryptedKey: key.encryptedKey.ciphertext,
          iv: key.encryptedKey.iv,
          ownerUserId: key.ownerUserId,
        },
        update: {
          encryptedKey: key.encryptedKey.ciphertext,
          iv: key.encryptedKey.iv,
        },
        where: {
          conversationId_ownerUserId: {
            conversationId: id,
            ownerUserId: key.ownerUserId,
          },
        },
      })
    )
  );

  return Response.json({ ok: true });
}
