import type {
  OfflineSearchCacheRecord,
  OfflineSearchCursor,
} from "./offline-search-cache";
import type { MessageData } from "./types";

export function shouldUseOfflineSearchForStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function encodeOfflineSearchCursor(
  cursor: OfflineSearchCursor | null
): string | null {
  return cursor ? JSON.stringify(cursor) : null;
}

export function decodeOfflineSearchCursor(
  value: string | null
): OfflineSearchCursor | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).createdAt !== "number" ||
      !Number.isSafeInteger((parsed as Record<string, unknown>).createdAt) ||
      typeof (parsed as Record<string, unknown>).id !== "string"
    ) {
      return undefined;
    }
    return parsed as OfflineSearchCursor;
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
