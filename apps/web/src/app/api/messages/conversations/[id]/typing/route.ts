import { publishTypingStarted } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  DEN_TYPING_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  getConversationForUser,
  hasLeftConversation,
  leftConversationResponse,
} from "@/lib/messages/server";

// Best-effort typing indicator: the client heartbeats while the user is
// typing and the peer's open SSE stream shows it. The event only carries the
// sender id (metadata, not plaintext), and the peer's client auto-clears it
// after a short timeout, so no server-side expiry is needed.
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ahead of the membership read, because this is the cheapest route on the
  // surface to drive in a loop and a limiter that runs after the read has
  // already paid for the read.
  const limited = await consumeDenRateLimit(DEN_TYPING_RATE_LIMIT, user.id);
  if (limited) {
    return limited;
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  // The read gate admits somebody who left a den so they keep their history; this
  // is the write half of that split.
  if (hasLeftConversation(conversation, user.id)) {
    return leftConversationResponse();
  }

  await publishTypingStarted(id, user.id);
  return Response.json({ ok: true });
}
