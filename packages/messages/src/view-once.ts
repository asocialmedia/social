export interface ViewOnceReceipt {
  seenAt: string | null;
  unavailable: boolean;
}

export function isViewOnceUnavailable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error.status === 404 || error.status === 410)
  );
}

export function retryViewOnceReceipt(
  failures: number,
  error: unknown
): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  ) {
    return false;
  }
  return failures < 5;
}

export function viewOnceReceiptKey(
  userId: string,
  conversationId: string,
  mediaId: string
) {
  return ["view-once-receipt", userId, conversationId, mediaId] as const;
}

export function formatViewOnceSeenAt(
  seenAt: string | null | undefined
): string | null {
  if (!seenAt) {
    return null;
  }
  const date = new Date(seenAt);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return `Seen at ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
