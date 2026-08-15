import { prisma } from "@asm/db";

import { getConversationForUser, parseJsonBody } from "@/lib/messages/server";
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

  const parsed = await parseJsonBody(request);
  const body = parsed as { keys?: WrappedKeyPayload[] } | null;
  const { keys } = body ?? {};
  if (!Array.isArray(keys) || keys.length === 0) {
    return Response.json({ error: "keys are required" }, { status: 400 });
  }

  // The caller (the conversation creator) must wrap the root key for every
  // member. Validate each owner is a member and every payload is well-formed
  // and non-empty (an empty ciphertext/iv would corrupt the peer's unwrap).
  const memberIds = new Set(
    conversation.members.map((member) => member.userId)
  );
  for (const key of keys) {
    if (
      typeof key.ownerUserId !== "string" ||
      !memberIds.has(key.ownerUserId) ||
      typeof key.encryptedKey?.ciphertext !== "string" ||
      key.encryptedKey.ciphertext.length === 0 ||
      typeof key.encryptedKey?.iv !== "string" ||
      key.encryptedKey.iv.length === 0
    ) {
      return Response.json({ error: "Invalid key payload" }, { status: 400 });
    }
  }

  // Create-only: a wrapped key may never be overwritten. Once a key exists for
  // an owner it is immutable, so a re-run (heal path, concurrent retry) is a
  // no-op instead of replacing the ciphertext the peer relies on.
  await prisma.messageConversationKey.createMany({
    data: keys.map((key) => ({
      conversationId: id,
      encryptedKey: key.encryptedKey.ciphertext,
      iv: key.encryptedKey.iv,
      ownerUserId: key.ownerUserId,
    })),
    skipDuplicates: true,
  });

  return Response.json({ ok: true });
}
