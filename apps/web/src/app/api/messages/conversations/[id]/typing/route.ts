import { publishTypingStarted } from "@asm/db";

import { getConversationForUser } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

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

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  await publishTypingStarted(id, user.id);
  return Response.json({ ok: true });
}
