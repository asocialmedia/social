import type {
  OfflineSearchCacheRecord,
  OfflineSearchCursor,
} from "./offline-search-cache";
import type { MessageData } from "./types";

export function shouldUseOfflineSearchForStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function encodeOfflineSearchCursor(
  cursor: OfflineSearchCursor | null,
  direction: "newer" | "older" = "older"
): string | null {
  return cursor
    ? JSON.stringify(direction === "newer" ? { ...cursor, direction } : cursor)
    : null;
}

export function decodeOfflineSearchCursor(
  value: string | null
): (OfflineSearchCursor & { direction?: "newer" | "older" }) | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      ((parsed as Record<string, unknown>).direction !== undefined &&
        (parsed as Record<string, unknown>).direction !== "newer" &&
        (parsed as Record<string, unknown>).direction !== "older") ||
      typeof (parsed as Record<string, unknown>).createdAt !== "number" ||
      !Number.isSafeInteger((parsed as Record<string, unknown>).createdAt) ||
      typeof (parsed as Record<string, unknown>).id !== "string"
    ) {
      return undefined;
    }
    return parsed as OfflineSearchCursor & { direction?: "newer" | "older" };
  } catch {
    return undefined;
  }
}

export function offlineSearchRecordToMessageData(
  conversationId: string,
  record: OfflineSearchCacheRecord
): MessageData {
  return {
    ciphertext: record.ciphertext,
    conversationId,
    createdAt: new Date(record.createdAt),
    deletedAt: null,
    editedAt: null,
    id: record.id,
    iv: record.iv,
    keyEpoch: record.keyEpoch,
    ratchetIndex: record.ratchetIndex,
    revision: record.revision,
    sender: null,
    senderId: record.senderId,
  };
}
