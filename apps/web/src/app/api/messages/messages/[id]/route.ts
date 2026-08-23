import { prisma, publishMessageDeleted } from "@asm/db";

import { areBlocked } from "@/lib/messages/server";
import { getSessionFromApi } from "@/lib/session";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const message = await prisma.message.findUnique({
    include: { conversation: { include: { members: true } } },
    where: { id },
  });
  if (!message) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  // Either member of a 1:1 conversation may delete any message in it —
  // unless a block exists between the pair: a blocked user must not be able
  // to reach into the conversation at all.
  const callerIsMember = message.conversation.members.some(
    (member) => member.userId === user.id
  );
  if (!callerIsMember) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const otherMember = message.conversation.members.find(
    (member) => member.userId !== user.id
  );
  if (otherMember && (await areBlocked(user.id, otherMember.userId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const deleted = await prisma.message.update({
    data: { deletedAt: new Date() },
    include: { sender: { select: { id: true } } },
    where: { id },
  });

  await publishMessageDeleted(message.conversationId, deleted);

  return Response.json({ ok: true });
}
