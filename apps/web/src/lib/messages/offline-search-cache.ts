import type { MessagePayload } from "@asm/messages/crypto";
import {
  messageSearchTerms,
  messageSearchTermsMatch,
  normalizeMessageSearchQuery,
  searchableTextFromPayload,
} from "@asm/messages/search";

import { extractPostUrls } from "@/lib/link-embeds/shared";
import { getMessageMediaId } from "@/lib/utils/image-url";

export const OFFLINE_SEARCH_MAX_MESSAGES_PER_CONVERSATION = 1000;
export const OFFLINE_SEARCH_MAX_ACCOUNT_BYTES = 32 * 1024 * 1024;
export const OFFLINE_SEARCH_MAX_PAGE_SIZE = 20;

export type OfflineSearchReferenceKind = "link" | "media" | "post";

export interface OfflineSearchReference {
  id?: string;
  index: number;
  kind: OfflineSearchReferenceKind;
  mediaKind?: "gif" | "image";
}

export interface OfflineSearchCacheRecord {
  cachedAt: number;
  ciphertext: string;
  conversationId: string;
  createdAt: number;
  id: string;
  iv: string;
  keyEpoch: number | null;
  ratchetIndex: number;
  references: OfflineSearchReference[];
  revision: number;
  senderId: string;
  terms: string[];
}

export interface OfflineSearchSourceMessage {
  ciphertext: string;
  conversationId: string;
  createdAt: Date | string;
  id: string;
  iv: string;
  keyEpoch: number | null;
  ratchetIndex: number;
  revision: number;
  senderId: string;
}

export interface OfflineSearchCursor {
  createdAt: number;
  id: string;
}

export interface OfflineSearchMatchRecord {
  createdAt: number;
  id: string;
  terms: string[];
}

export interface OfflineSearchPage<
  T extends OfflineSearchMatchRecord = OfflineSearchCacheRecord,
> {
  hasMore: boolean;
  hits: T[];
  nextCursor: OfflineSearchCursor | null;
  previousCursor: OfflineSearchCursor | null;
  totalMatches: number;
}

export interface OfflineSearchRetentionResult {
  evictedConversationIds: string[];
  evictedMessageKeys: string[];
  records: OfflineSearchCacheRecord[];
  totalBytes: number;
}

function timestamp(value: Date | string): number | null {
  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function referencesForPayload(
  payload: MessagePayload
): OfflineSearchReference[] {
  const references: OfflineSearchReference[] = [];
  if (payload.type === "post") {
    references.push({ id: payload.postId, index: 0, kind: "post" });
  }
  if (payload.type === "media") {
    const images = "images" in payload ? payload.images : [payload];
    for (const [index, image] of images.entries()) {
      const id = getMessageMediaId(image.url);
      references.push({
        ...(id ? { id } : {}),
        index,
        kind: "media",
        mediaKind: payload.kind,
      });
    }
  }
  const content = typeof payload.content === "string" ? payload.content : "";
  for (const [index] of extractPostUrls(content).entries()) {
    references.push({ index, kind: "link" });
  }
  return references;
}

export function buildOfflineSearchCacheRecord(input: {
  cachedAt?: number;
  message: OfflineSearchSourceMessage;
  payload: MessagePayload;
}): OfflineSearchCacheRecord | null {
  const createdAt = timestamp(input.message.createdAt);
  if (
    createdAt === null ||
    !Number.isSafeInteger(input.message.revision) ||
    input.message.revision < 0 ||
    !Number.isSafeInteger(input.message.ratchetIndex) ||
    input.message.ratchetIndex < 0 ||
    (input.message.keyEpoch !== null &&
      (!Number.isSafeInteger(input.message.keyEpoch) ||
        input.message.keyEpoch < 0))
  ) {
    return null;
  }
  return {
    cachedAt: input.cachedAt ?? Date.now(),
    ciphertext: input.message.ciphertext,
    conversationId: input.message.conversationId,
    createdAt,
    id: input.message.id,
    iv: input.message.iv,
    keyEpoch: input.message.keyEpoch,
    ratchetIndex: input.message.ratchetIndex,
    references: referencesForPayload(input.payload),
    revision: input.message.revision,
    senderId: input.message.senderId,
    terms: messageSearchTerms(searchableTextFromPayload(input.payload)),
  };
}

export function estimateOfflineSearchRecordBytes(
  record: OfflineSearchCacheRecord
): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

export function rememberOfflineIndexedRevision(
  revisions: Map<string, number>,
  id: string,
  revision: number
): void {
  revisions.delete(id);
  revisions.set(id, revision);
  while (revisions.size > OFFLINE_SEARCH_MAX_MESSAGES_PER_CONVERSATION) {
    const oldest = revisions.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    revisions.delete(oldest);
  }
}

function compareOfflineSearchRecords(
  left: OfflineSearchMatchRecord,
  right: OfflineSearchMatchRecord
): number {
  const timestampDifference = right.createdAt - left.createdAt;
  if (timestampDifference || left.id === right.id) {
    return timestampDifference;
  }
  return left.id < right.id ? 1 : -1;
}

export function offlineSearchRecords<T extends OfflineSearchMatchRecord>(
  records: readonly T[],
  input: {
    after?: OfflineSearchCursor;
    before?: OfflineSearchCursor;
    limit?: number;
    query: string;
  }
): OfflineSearchPage<T> {
  const normalized = normalizeMessageSearchQuery(input.query);
  if (!normalized.valid) {
    return {
      hasMore: false,
      hits: [],
      nextCursor: null,
      previousCursor: null,
      totalMatches: 0,
    };
  }

  const matches = records
    .filter((record) => messageSearchTermsMatch(record.terms, input.query))
    .toSorted(compareOfflineSearchRecords);
  const { before, after } = input;
  if (before && after) {
    throw new TypeError("An offline search page can use only one cursor");
  }
  let candidates = matches;
  if (before) {
    candidates = matches.filter(
      (record) =>
        record.createdAt < before.createdAt ||
        (record.createdAt === before.createdAt && record.id < before.id)
    );
  } else if (after) {
    candidates = matches
      .filter(
        (record) =>
          record.createdAt > after.createdAt ||
          (record.createdAt === after.createdAt && record.id > after.id)
      )
      .toReversed();
  }
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? OFFLINE_SEARCH_MAX_PAGE_SIZE), 1),
    OFFLINE_SEARCH_MAX_PAGE_SIZE
  );
  const nearestHits = candidates.slice(0, limit);
  const hits = after ? nearestHits.toReversed() : nearestHits;
  const [firstHit] = hits;
  const lastHit = hits.at(-1);
  const nextCursor =
    lastHit && (after || candidates.length > hits.length)
      ? { createdAt: lastHit.createdAt, id: lastHit.id }
      : null;
  return {
    hasMore: nextCursor !== null,
    hits,
    nextCursor,
    previousCursor:
      firstHit && (before || (after && candidates.length > hits.length))
        ? { createdAt: firstHit.createdAt, id: firstHit.id }
        : null,
    totalMatches: matches.length,
  };
}

function messageKey(record: OfflineSearchCacheRecord): string {
  return `${record.conversationId}\u0000${record.id}`;
}

export function retainOfflineSearchRecords(input: {
  activeConversationId: string;
  budgetBytes?: number;
  existing: readonly OfflineSearchCacheRecord[];
  incoming: readonly OfflineSearchCacheRecord[];
}): OfflineSearchRetentionResult {
  const budgetBytes = Math.max(
    0,
    Math.trunc(input.budgetBytes ?? OFFLINE_SEARCH_MAX_ACCOUNT_BYTES)
  );
  const recordsByMessage = new Map(
    input.existing.map((record) => [messageKey(record), record])
  );
  for (const record of input.incoming) {
    const key = messageKey(record);
    const existing = recordsByMessage.get(key);
    if (!existing || record.revision >= existing.revision) {
      recordsByMessage.set(key, record);
    }
  }

  const removed = new Set<string>();
  const byConversation = new Map<string, OfflineSearchCacheRecord[]>();
  for (const record of recordsByMessage.values()) {
    const rows = byConversation.get(record.conversationId) ?? [];
    rows.push(record);
    byConversation.set(record.conversationId, rows);
  }
  for (const rows of byConversation.values()) {
    rows.sort(compareOfflineSearchRecords);
    for (const record of rows.slice(
      OFFLINE_SEARCH_MAX_MESSAGES_PER_CONVERSATION
    )) {
      removed.add(messageKey(record));
    }
  }

  const retained = () =>
    [...recordsByMessage.values()].filter(
      (record) => !removed.has(messageKey(record))
    );
  const totalBytes = (rows: readonly OfflineSearchCacheRecord[]) =>
    rows.reduce(
      (sum, record) => sum + estimateOfflineSearchRecordBytes(record),
      0
    );
  let remaining = retained();
  let bytes = totalBytes(remaining);
  const nonActiveOldestFirst = remaining
    .filter((record) => record.conversationId !== input.activeConversationId)
    .toSorted(
      (left, right) =>
        left.cachedAt - right.cachedAt ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id)
    );
  for (const record of nonActiveOldestFirst) {
    if (bytes <= budgetBytes) {
      break;
    }
    removed.add(messageKey(record));
    bytes -= estimateOfflineSearchRecordBytes(record);
  }

  if (bytes > budgetBytes) {
    const activeOldestFirst = retained()
      .filter((record) => record.conversationId === input.activeConversationId)
      .toSorted(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id)
      );
    for (const record of activeOldestFirst) {
      if (bytes <= budgetBytes) {
        break;
      }
      removed.add(messageKey(record));
      bytes -= estimateOfflineSearchRecordBytes(record);
    }
  }

  remaining = retained();
  const evictedConversationIds = [...byConversation.keys()].filter((id) =>
    byConversation.get(id)?.every((record) => removed.has(messageKey(record)))
  );
  return {
    evictedConversationIds,
    evictedMessageKeys: [...removed],
    records: remaining,
    totalBytes: totalBytes(remaining),
  };
}
