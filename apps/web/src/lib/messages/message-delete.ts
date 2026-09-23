// Confirmation copy for message deletion. Kept pure and unit-tested so the
// destructive-action wording cannot drift between the single and bulk paths,
// and so "delete for me" (actor-scoped) is never described like "delete for
// everyone" (removes the peer's copy too).

export type MessageDeleteScope = "for-everyone" | "for-me";

export interface MessageDeleteCopy {
  confirmLabel: string;
  description: string;
  title: string;
}

// Upper bound on one hide request. The route enforces the same value, so a
// large multi-select must be chunked rather than sent as a single oversized
// batch (which the server rejects wholesale). Shared here so the client and
// route cannot disagree.
export const MAX_HIDE_BATCH = 100;

// Splits ids into request-sized chunks. Used by "delete for me" so selecting
// more than MAX_HIDE_BATCH messages still succeeds. Preserves order.
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

// Builds the dialog copy for a pending delete. `count` is the number of
// messages the confirm will act on; it is ignored for "for-everyone", which is
// always a single message.
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
