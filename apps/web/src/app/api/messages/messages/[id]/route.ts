import type { MessageData, ConversationType } from "@asm/db";
import {
  commitMessageSearchMutation,
  enqueueMessageSearchOutbox,
  fromPrismaDateTime,
  prisma,
  publishMessageDeleted,
  publishMessageEdited,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  DEN_MESSAGE_DELETE_RATE_LIMIT,
  DEN_MESSAGE_EDIT_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";
import {
  isWithinEditWindow,
  MAX_MESSAGE_CIPHERTEXT_LENGTH,
  MESSAGE_EDIT_WINDOW_MS,
} from "@/lib/messages/edit-window";
import {
  isBlockedFromConversation,
  parseJsonBody,
} from "@/lib/messages/server";

// The block decision for a message's own conversation, delegated to the shared
// predicates rather than re-derived - and in particular reading the type, which
// the two write paths below used not to select at all.
//
// Both of them used to reach for "somebody who is not the sender" and test a
// block against them. In a DM that is the peer and it is right. In a den it is
// one arbitrary member out of up to ninety-nine, so whether a member could delete
// or edit their own message depended on which member the roster happened to
// return first: a den that put the blocked person first went silent for that one
// sender and nobody else, and the other five surfaces answered the opposite way
// about the same den. This is the sixth copy of the rule, and it is now none of
// them.
//
// A den still passes through here on every delete and edit, and answers no every
// time, because a block is a DM-only rule. That is a wasted call per den write,
// which is the price of one shared predicate over two conversation types, and it
// is cheaper than the second copy this used to be.
function blockedFromConversation(
  conversation: {
    _type: ConversationType;
    messageConversationMembers: { userId: string }[];
  },
  userId: string
): Promise<boolean> {
  return isBlockedFromConversation(
    {
      members: conversation.messageConversationMembers,
      type: conversation._type,
    },
    userId
  );
}

function enqueueSearchMutation(outboxId: string): void {
  void (async () => {
    try {
      await enqueueMessageSearchOutbox(outboxId);
    } catch {
      console.error("Failed to enqueue DM search update");
    }
  })();
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Metered before the row read, which pulls the message AND its conversation
  // AND the whole membership list. Separate buckets per method: an edit rewrites
  // up to 100KB of ciphertext and a delete rewrites one timestamp, and a shared
  // budget would let an edit storm lock somebody out of removing their own
  // message.
  const limited = await consumeDenRateLimit(
    DEN_MESSAGE_DELETE_RATE_LIMIT,
    user.id
  );
  if (limited) {
    return limited;
  }

  const { id } = await ctx.params;
  const message = await prisma.orm.public.Messages.where({ id })
    .include("conversation", (conversation) =>
      conversation.include("messageConversationMembers", (member) =>
        member.select("leftAt", "userId")
      )
    )
    .first();
  if (!message) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }
  if (!message.conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
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

  // A row with `leftAt` set is somebody who left a den: they still have the row so
  // they keep their history, and they are not in the room any more, so they cannot
  // rewrite or remove what is in it. Both verbs refuse the same way.
  const callerIsMember = message.conversation.messageConversationMembers.some(
    // `!member.leftAt` rather than `=== null`: a DM row and every fixture built
    // before this column existed carry no `leftAt` at all, and reading that as
    // "departed" would refuse edits on ordinary DMs.
    (member) => member.userId === user.id && !member.leftAt
  );
  if (!callerIsMember) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (await blockedFromConversation(message.conversation, user.id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const mutation = await commitMessageSearchMutation({
    conversationId: message.conversationId,
    deletedAt: new Date(),
    expectedRevision: message.revision,
    kind: "delete",
    messageId: id,
    senderId: user.id,
  });
  if (mutation.status === "not-found") {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }
  if (mutation.status === "revision-conflict") {
    return Response.json(
      { error: "This message changed before it could be deleted" },
      { status: 409 }
    );
  }
  if (mutation.status === "updated") {
    enqueueSearchMutation(mutation.outboxId);
  }

  await publishMessageDeleted(message.conversationId, {
    id,
    revision:
      mutation.status === "updated" ? mutation.revision : message.revision,
  });

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

  // See DELETE for why the gate sits ahead of the row read and why this budget
  // is the tighter of the two.
  const limited = await consumeDenRateLimit(
    DEN_MESSAGE_EDIT_RATE_LIMIT,
    user.id
  );
  if (limited) {
    return limited;
  }

  const { id } = await ctx.params;
  const message = await prisma.orm.public.Messages.where({ id })
    .include("conversation", (conversation) =>
      conversation.include("messageConversationMembers", (member) =>
        member.select("leftAt", "userId")
      )
    )
    .first();
  if (!message?.conversation) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  // Sender-only: stricter than the global delete's membership check, because
  // rewriting someone else's words is impersonation.
  if (message.senderId !== user.id) {
    return Response.json(
      { error: "You can only edit your own messages" },
      { status: 403 }
    );
  }

  // A row with `leftAt` set is somebody who left a den: they still have the row so
  // they keep their history, and they are not in the room any more, so they cannot
  // rewrite or remove what is in it. Both verbs refuse the same way.
  const callerIsMember = message.conversation.messageConversationMembers.some(
    // `!member.leftAt` rather than `=== null`: a DM row and every fixture built
    // before this column existed carry no `leftAt` at all, and reading that as
    // "departed" would refuse edits on ordinary DMs.
    (member) => member.userId === user.id && !member.leftAt
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

  if (!isWithinEditWindow(fromPrismaDateTime(message.createdAt))) {
    return Response.json(
      { error: "This message can no longer be edited" },
      { status: 409 }
    );
  }

  if (await blockedFromConversation(message.conversation, user.id)) {
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

  const editedAt = new Date();
  const mutation = await commitMessageSearchMutation({
    ciphertext: body.ciphertext,
    conversationId: message.conversationId,
    editWindowStart: new Date(editedAt.getTime() - MESSAGE_EDIT_WINDOW_MS),
    editedAt,
    expectedRevision: message.revision,
    iv: body.iv,
    kind: "upsert",
    messageId: id,
    senderId: user.id,
  });
  if (mutation.status === "not-found") {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }
  if (mutation.status === "edit-expired") {
    return Response.json(
      { error: "This message can no longer be edited" },
      { status: 409 }
    );
  }
  if (mutation.status !== "updated") {
    return Response.json(
      {
        error:
          mutation.status === "already-deleted"
            ? "This message was deleted"
            : "This message changed before it could be edited",
      },
      { status: 409 }
    );
  }
  enqueueSearchMutation(mutation.outboxId);

  const edited = await prisma.orm.public.Messages.where({ id })
    .include("sender", (sender) =>
      sender.select(
        "avatarUrl",
        "badge",
        "badges",
        "displayName",
        "id",
        "username"
      )
    )
    .first();
  if (!edited) {
    // Raced by a hard delete (there is none today, but the row can vanish if a
    // future retention job runs): the write already succeeded, so report the
    // success without a payload the client cannot fold.
    return Response.json({ ok: true });
  }

  try {
    await publishMessageEdited(message.conversationId, edited as MessageData);
  } catch (error) {
    console.error("Failed to publish message edited:", error);
  }

  return Response.json({ message: edited });
}
