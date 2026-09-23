import { prisma, publishMessageDeleted, publishMessageEdited } from "@asm/db";
import type { MessageData } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  isWithinEditWindow,
  MAX_MESSAGE_CIPHERTEXT_LENGTH,
  MESSAGE_EDIT_WINDOW_MS,
} from "@/lib/messages/edit-window";
import {
  areBlocked,
  messageSenderSelect,
  parseJsonBody,
} from "@/lib/messages/server";

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

  // "Delete for everyone" is sender-only. Deleting another member's words is
  // impersonation, so a receiver must use the per-user hide endpoint instead
  // (DELETE /:id handled here is the global, visible-to-both path).
  if (message.senderId !== user.id) {
    return Response.json(
      { error: "You can only delete your own messages for everyone" },
      { status: 403 }
    );
  }

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

// Rewrites a message's ciphertext in place. The ratchet index is part of the
// derived message key and the per-sender index sequence is dense, so an edit
// MUST re-encrypt under the same (rootKey, senderId, ratchetIndex) with a fresh
// IV: minting a new index would desync every later message's key and rewriting
// the row's `ratchetIndex` would make the existing history undecryptable.
//
// Only the original sender may edit, and only inside the fixed window measured
// from the server's `createdAt` — never the client's clock. The edit does not
// touch the conversation's `updatedAt` (an edit is not new activity and must
// not reorder the inbox), does not change `ratchetCounter`, and never accrues
// unread for the peer.
export async function PATCH(
  request: Request,
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

  // Sender-only: stricter than delete (which either member may perform),
  // because rewriting someone else's words is impersonation.
  if (message.senderId !== user.id) {
    return Response.json(
      { error: "You can only edit your own messages" },
      { status: 403 }
    );
  }

  const callerIsMember = message.conversation.members.some(
    (member) => member.userId === user.id
  );
  if (!callerIsMember) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (message.deletedAt) {
    return Response.json(
      { error: "This message was deleted" },
      { status: 409 }
    );
  }

  if (!isWithinEditWindow(message.createdAt)) {
    return Response.json(
      { error: "This message can no longer be edited" },
      { status: 409 }
    );
  }

  const otherMember = message.conversation.members.find(
    (member) => member.userId !== user.id
  );
  if (otherMember && (await areBlocked(user.id, otherMember.userId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await parseJsonBody(request)) as {
    ciphertext?: unknown;
    iv?: unknown;
  } | null;
  if (
    body === null ||
    typeof body.ciphertext !== "string" ||
    body.ciphertext.length === 0 ||
    typeof body.iv !== "string" ||
    body.iv.length === 0
  ) {
    return Response.json({ error: "Invalid message payload" }, { status: 400 });
  }
  if (body.ciphertext.length > MAX_MESSAGE_CIPHERTEXT_LENGTH) {
    return Response.json({ error: "Message is too large" }, { status: 413 });
  }

  // The update is unconditional on `editedAt`/`deletedAt` at the SQL level, but
  // the checks above ran in the same request: a concurrent delete landing in
  // between would be overwritten by this write. Scope the update to a live row
  // (and re-assert the sender + window at the SQL level) so a racing delete or a
  // window that lapses between the read and the write cannot slip through.
  const editedAt = new Date();
  const updated = await prisma.message.updateMany({
    data: { ciphertext: body.ciphertext, editedAt, iv: body.iv },
    where: {
      createdAt: { gte: new Date(editedAt.getTime() - MESSAGE_EDIT_WINDOW_MS) },
      deletedAt: null,
      id,
      senderId: user.id,
    },
  });
  if (updated.count === 0) {
    return Response.json(
      { error: "This message was deleted" },
      { status: 409 }
    );
  }

  const edited = (await prisma.message.findUnique({
    include: messageSenderSelect(),
    where: { id },
  })) as MessageData | null;
  if (!edited) {
    // Raced by a hard delete (there is none today, but the row can vanish if a
    // future retention job runs): the write already succeeded, so report the
    // success without a payload the client cannot fold.
    return Response.json({ ok: true });
  }

  try {
    await publishMessageEdited(message.conversationId, edited);
  } catch (error) {
    console.error("Failed to publish message edited:", error);
  }

  return Response.json({ message: edited });
}
