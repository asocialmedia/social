// Confirmation copy for message deletion. Identical to web's
// components/messages message-delete logic, kept pure and unit-tested so the
// destructive-action wording cannot drift between the single and bulk paths, and
// so "delete for me" (actor-scoped) is never described like "delete for everyone"
// (removes the peer's copy too).

export type MessageDeleteScope = "for-everyone" | "for-me";

export interface MessageDeleteCopy {
  confirmLabel: string;
  description: string;
  title: string;
}

// Upper bound on one hide request. The route enforces the same value, so a large
// multi-select must be chunked rather than sent as one oversized batch. Shared here
// so the client and the route cannot disagree.
export const MAX_HIDE_BATCH = 100;

// Splits ids into request-sized chunks. Preserves order.
export function chunkMessageIds(
  messageIds: readonly string[],
  size = MAX_HIDE_BATCH
): string[][] {
  if (size <= 0) {
    throw new Error("chunk size must be positive");
  }
  const chunks: string[][] = [];
  for (let index = 0; index < messageIds.length; index += size) {
    chunks.push(messageIds.slice(index, index + size));
  }
  return chunks;
}

// How long after sending a message its sender may still rewrite or retract it
// for everyone. Mirrors the web `MESSAGE_EDIT_WINDOW_MS`
// (`apps/web/src/lib/messages/edit-window.ts`); the server measures from the
// stored `createdAt`, the client only hides actions that would be rejected.
export const MESSAGE_EDIT_WINDOW_MS = 12 * 60 * 60 * 1000;

// Whether a message is still inside its edit window. Accepts the serialized
// ISO strings rows arrive as, and fails closed on garbage input.
export function isWithinEditWindow(
  createdAt: Date | string,
  now: Date = new Date()
): boolean {
  const created =
    typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(created.getTime())) {
    return false;
  }
  return now.getTime() - created.getTime() <= MESSAGE_EDIT_WINDOW_MS;
}

export interface DeleteGateMessage {
  createdAt: Date | string;
  deletedAt?: Date | string | null;
  senderId: string;
}

// "Delete for everyone" is the sender retracting their own live message,
// exactly the web thread's gate (`canDeleteForEveryone` in
// `apps/web/src/components/messages/message-thread.tsx`).
export function canDeleteForEveryone(
  message: DeleteGateMessage,
  userId: string | null
): boolean {
  if (!userId) {
    return false;
  }
  return message.senderId === userId && !message.deletedAt;
}

// "Edit" is the sender rewriting their own live message inside the window,
// the web thread's `canEdit` gate.
export function canEditMessage(
  message: DeleteGateMessage,
  userId: string | null,
  now: Date = new Date()
): boolean {
  if (!userId || message.deletedAt || message.senderId !== userId) {
    return false;
  }
  return isWithinEditWindow(message.createdAt, now);
}

// The delete dialog shows one message for "for-everyone" and the selected
// count for "for-me" (web thread builds the same `pendingDelete` union).
export type PendingMessageDelete =
  | { messageIds: readonly string[]; scope: "for-me" }
  | { message: { id: string }; scope: "for-everyone" };

export function pendingDeleteCount(pending: PendingMessageDelete): number {
  return pending.scope === "for-everyone" ? 1 : pending.messageIds.length;
}
export function messageDeleteCopy(input: {
  count: number;
  scope: MessageDeleteScope;
}): MessageDeleteCopy {
  if (input.scope === "for-everyone") {
    return {
      confirmLabel: "Delete for everyone",
      description:
        "This message will be removed for both of you. This can't be undone.",
      title: "Delete for everyone?",
    };
  }
  if (input.count > 1) {
    return {
      confirmLabel: "Delete for me",
      description:
        "They'll be hidden from your view. The other person will still see them.",
      title: `Delete ${input.count} messages for me?`,
    };
  }
  return {
    confirmLabel: "Delete for me",
    description:
      "It'll be hidden from your view. The other person will still see it.",
    title: "Delete for me?",
  };
}
