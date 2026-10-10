import { listDenMembershipEvents } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { getConversationForUser } from "@/lib/messages/server";

// The den's durable membership log: who joined, left, was removed, or had their
// role moved. The transcript renders these as centered lines between messages.
//
// Gated by the READ membership check, which deliberately admits somebody who left
// a den so they keep their history. The cutoff is then their own `leftAt`: the log
// they get back stops at the moment they walked out, because everything after it
// is about a room they are no longer in.
//
// A DM has no membership log, and answers with an empty list rather than a 404:
// the thread asks for the log of every conversation it opens, and a DM is not an
// error, it is a conversation with nothing to log.
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

  if (conversation.type !== "DEN") {
    return Response.json({ events: [] });
  }

  const myMember = conversation.members.find(
    (member) => member.userId === user.id
  );
  const events = await listDenMembershipEvents(id, myMember?.leftAt ?? null);
  return Response.json({
    events: events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
