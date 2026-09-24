import { and, prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { parseJsonBody } from "@/lib/messages/server";

// Hard cap so an unbounded block list can never balloon a response.
const BLOCK_LIST_LIMIT = 100;

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blocks = await prisma.orm.public.Blocks.select(
    "blockerId",
    "blockedId",
    "createdAt"
  )
    .include("blocked", (blocked) =>
      blocked.select("avatarUrl", "displayName", "id", "username")
    )
    .where((block) => block.blockerId.eq(user.id))
    .orderBy((block) => block.createdAt.desc())
    .limit(BLOCK_LIST_LIMIT)
    .all();

  return Response.json({
    blockedUsers: blocks.map((block) => block.blocked),
  });
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  const body = parsed as { userId?: string } | null;
  const blockedId = body?.userId;
  if (typeof blockedId !== "string" || blockedId.length === 0) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  if (blockedId === user.id) {
    return Response.json({ error: "Cannot block yourself" }, { status: 400 });
  }

  const target = await prisma.orm.public.Users.select("id")
    .where({ id: blockedId })
    .first();
  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // Only a *fresh* block revokes key material; re-blocking an already
  // blocked pair must not keep churning the conversation keys.
  const existingBlock = await prisma.orm.public.Blocks.select("blockerId")
    .where((block) =>
      and(block.blockedId.eq(blockedId), block.blockerId.eq(user.id))
    )
    .first();

  if (!existingBlock) {
    await prisma.orm.public.Blocks.create({ blockedId, blockerId: user.id });
  }

  // Defense in depth for the E2EE layer: strip the blocked party's wrapped
  // conversation key so they can no longer fetch the root key through the API
  // (the shared conversation gate already returns 404 for a blocked pair).
  // The blocker's own key row is untouched, so their client keeps working.
  if (!existingBlock) {
    await revokeBlockedConversationKeys(user.id, blockedId);
  }

  return Response.json({ ok: true }, { status: 201 });
}

// The 1:1 conversation between two users is identified by its deterministic
// pair key; delete the blocked party's wrapped key row only.
async function revokeBlockedConversationKeys(
  blockerId: string,
  blockedId: string
) {
  try {
    const pairKey = [blockerId, blockedId].toSorted().join(":");
    const conversation = await prisma.orm.public.MessageConversations.select(
      "id"
    )
      .where({ pairKey })
      .first();
    if (!conversation) {
      return;
    }
    await prisma.orm.public.MessageConversationKeys.where((key) =>
      and(key.conversationId.eq(conversation.id), key.ownerUserId.eq(blockedId))
    ).delete();
  } catch (error) {
    console.error("Failed to revoke blocked conversation keys:", error);
  }
}
