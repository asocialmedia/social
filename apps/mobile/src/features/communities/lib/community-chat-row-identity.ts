// Referential stability for community chat timeline rows.
// The server returns fresh message objects on every fetch, so a merge that
// changed nothing would still hand every row a new identity and defeat the
// memo on CommunityChatMessageRow. Reusing the previous object when nothing
// the row renders changed keeps a busy channel (SSE event, 30s reconcile)
// from re-rendering the whole transcript.
import type { CommunityChatMessage } from "@asm/messages";

// True when two snapshots of the same row render identically. Any
// content-affecting server change bumps revision or changeSequence, but the
// payload, reactions, reply reference and sender profile are compared
// explicitly so a missed bump still refreshes the row instead of showing
// stale content.
export function sameCommunityChatMessageRow(
  left: CommunityChatMessage,
  right: CommunityChatMessage
): boolean {
  if (left === right) {
    return true;
  }
  if (
    left.id !== right.id ||
    left.sequence !== right.sequence ||
    left.revision !== right.revision ||
    left.changeSequence !== right.changeSequence ||
    left.deletedAt !== right.deletedAt ||
    left.editedAt !== right.editedAt ||
    (left.pinned ?? false) !== (right.pinned ?? false) ||
    left.replyToId !== right.replyToId ||
    left.senderId !== right.senderId
  ) {
    return false;
  }
  if (!sameRowSender(left.sender, right.sender)) {
    return false;
  }
  if (!sameRowReactions(left.reactions, right.reactions)) {
    return false;
  }
  if (!sameRowReplyRef(left.replyTo, right.replyTo)) {
    return false;
  }
  if (left.payload === right.payload) {
    return true;
  }
  return JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

function sameRowSender(
  left: CommunityChatMessage["sender"],
  right: CommunityChatMessage["sender"]
): boolean {
  return (
    left.id === right.id &&
    (left.avatarUrl ?? null) === (right.avatarUrl ?? null) &&
    left.displayName === right.displayName &&
    left.username === right.username &&
    (left.role ?? null) === (right.role ?? null)
  );
}

function sameRowReactions(
  left: CommunityChatMessage["reactions"],
  right: CommunityChatMessage["reactions"]
): boolean {
  const a = left ?? [];
  const b = right ?? [];
  if (a.length !== b.length) {
    return false;
  }
  return a.every(
    (reaction, index) =>
      reaction.emoji === b[index]?.emoji &&
      reaction.count === b[index]?.count &&
      reaction.reacted === b[index]?.reacted
  );
}

function sameRowReplyRef(
  left: CommunityChatMessage["replyTo"],
  right: CommunityChatMessage["replyTo"]
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.id === right.id &&
    left.deleted === right.deleted &&
    (left.content ?? null) === (right.content ?? null) &&
    left.senderName === right.senderName
  );
}

// Reuses previous row objects when the incoming timeline renders identically,
// so a poll or SSE merge that changed nothing (or changed one row) keeps the
// other rows' identities. Returns the previous array itself when every row is
// identical, so the list can bail out of the update entirely.
export function stabilizeCommunityChatRows(
  previous: CommunityChatMessage[],
  next: CommunityChatMessage[]
): CommunityChatMessage[] {
  if (previous.length === 0 || next.length === 0) {
    return [...next];
  }
  const byId = new Map(previous.map((row) => [row.id, row]));
  let allSame = previous.length === next.length;
  const merged = next.map((row) => {
    const old = byId.get(row.id);
    if (old && sameCommunityChatMessageRow(old, row)) {
      return old;
    }
    if (old !== row) {
      allSame = false;
    }
    return row;
  });
  if (allSame && merged.every((row, index) => row === previous[index])) {
    return previous;
  }
  return merged;
}
