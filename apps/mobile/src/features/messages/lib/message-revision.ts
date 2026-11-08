// Revision ordering for message rows, ported from
// apps/web/src/lib/messages/message-revision.ts. The fetched copy of a row is
// not always the newest: an edit or deletion received while a read was in
// flight must win over the order in which network responses arrive.
export interface MessageRevisionState {
  deletedAt?: Date | string | null;
  revision?: number;
}

export function shouldReplaceMessageRevision(
  current: MessageRevisionState,
  incoming: MessageRevisionState
): boolean {
  if (current.deletedAt && !incoming.deletedAt) {
    return false;
  }
  if (
    incoming.revision !== undefined &&
    (!Number.isSafeInteger(incoming.revision) || incoming.revision < 1)
  ) {
    return false;
  }
  if (
    current.revision !== undefined &&
    (!Number.isSafeInteger(current.revision) ||
      current.revision < 1 ||
      incoming.revision === undefined ||
      incoming.revision <= current.revision)
  ) {
    return false;
  }
  return true;
}
