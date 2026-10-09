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

export function shouldReconcileMessageEvent(kind: string): boolean {
  return (
    kind === "message.edited" ||
    kind === "message.deleted" ||
    kind === "keys.rotated" ||
    kind === "den.membership.changed"
  );
}
