// Pure helpers for the cross-conversation message search on the list screen.
//
// Ported from apps/web/src/lib/messages/use-global-message-search.ts,
// global-message-search-results.tsx and global-message-search-profiles.tsx.
// The server matches normalized query grams against its index and returns only
// ciphertext; the preview snippet is decrypted and ranked here, on the device,
// through the same decryptor and key source the thread uses.
//
// No React and no React Native imports, so the whole file runs under bun test.

import { orderedCopy } from "@/lib/format/ordered-copy";

import type { MessagePayload } from "./crypto";
import { extractSearchableText, rankSearchResults } from "./message-search";
import type { RankedSearchResult } from "./message-search";

export const GLOBAL_SEARCH_DEBOUNCE_MS = 250;
export const GLOBAL_SEARCH_PAGE_SIZE = 20;
export const GLOBAL_SEARCH_MAX_RETAINED_HITS = 60;
export const GLOBAL_SEARCH_TIMEOUT_MS = 12_000;
export const PROFILE_PREVIEW_LIMIT = 5;

export type GlobalMessageSearchFilter = "ALL" | "DEN" | "DM";

export interface GlobalMessageSearchHit {
  ciphertext: string;
  conversationAvatarMediaId: string | null;
  conversationId: string;
  conversationName: string | null;
  conversationType: "DEN" | "DM";
  createdAt: string;
  expiresAt: string | null;
  id: string;
  iv: string;
  keyEpoch: number;
  peerAvatarUrl: string | null;
  peerName: string | null;
  peerUsername: string | null;
  ratchetIndex: number;
  revision: number;
  rootKeyCiphertext: string | null;
  rootKeyIv: string | null;
  rootKeyWrapperPublicKey: string | null;
  senderId: string;
  senderName: string;
  senderUsername: string;
}

export interface GlobalMessageSearchPage {
  coverageComplete: boolean;
  coveragePaused: boolean;
  hasMore: boolean;
  hits: GlobalMessageSearchHit[];
  nextCursor: string | null;
  sessionToken: string;
}

export interface GlobalMessageSearchResult {
  hit: GlobalMessageSearchHit;
  preview: RankedSearchResult | null;
  previewFailed: boolean;
}

// A failed global search request. `retryAt` is an epoch-ms deadline the retry
// button counts down to; `restartRequired` means the signed session no longer
// matches the scope and paging must start over.
export class GlobalSearchRequestError extends Error {
  readonly restartRequired: boolean;
  readonly retryAt: number;

  constructor(message: string, retryAt = 0, restartRequired = false) {
    super(message);
    this.name = "GlobalSearchRequestError";
    this.retryAt = retryAt;
    this.restartRequired = restartRequired;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// Validates one hit with the same rules as web's parseHit: every field typed,
// timestamps parseable, and the root-key wrap either fully present or absent.
export function parseGlobalSearchHit(
  value: unknown
): GlobalMessageSearchHit | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    ciphertext,
    conversationAvatarMediaId,
    conversationId,
    conversationName,
    conversationType,
    createdAt,
    expiresAt,
    id,
    iv,
    keyEpoch,
    peerAvatarUrl,
    peerName,
    peerUsername,
    ratchetIndex,
    revision,
    rootKeyCiphertext,
    rootKeyIv,
    rootKeyWrapperPublicKey,
    senderId,
    senderName,
    senderUsername,
  } = value;
  if (
    typeof ciphertext !== "string" ||
    typeof conversationId !== "string" ||
    (conversationType !== "DEN" && conversationType !== "DM") ||
    !isDateString(createdAt) ||
    typeof id !== "string" ||
    typeof iv !== "string" ||
    !isSafeInteger(keyEpoch) ||
    !isSafeInteger(ratchetIndex) ||
    !isSafeInteger(revision) ||
    typeof senderId !== "string" ||
    typeof senderName !== "string" ||
    typeof senderUsername !== "string" ||
    !isNullableString(conversationAvatarMediaId) ||
    !isNullableString(conversationName) ||
    !isNullableString(expiresAt) ||
    !isNullableString(peerAvatarUrl) ||
    !isNullableString(peerName) ||
    !isNullableString(peerUsername) ||
    !isNullableString(rootKeyCiphertext) ||
    !isNullableString(rootKeyIv) ||
    !isNullableString(rootKeyWrapperPublicKey)
  ) {
    return null;
  }
  if (expiresAt !== null && !isDateString(expiresAt)) {
    return null;
  }
  if (
    (rootKeyCiphertext === null) !== (rootKeyIv === null) ||
    (rootKeyCiphertext === null) !== (rootKeyWrapperPublicKey === null)
  ) {
    return null;
  }
  return {
    ciphertext,
    conversationAvatarMediaId,
    conversationId,
    conversationName,
    conversationType,
    createdAt,
    expiresAt,
    id,
    iv,
    keyEpoch,
    peerAvatarUrl,
    peerName,
    peerUsername,
    ratchetIndex,
    revision,
    rootKeyCiphertext,
    rootKeyIv,
    rootKeyWrapperPublicKey,
    senderId,
    senderName,
    senderUsername,
  };
}

// A page is accepted whole or not at all: one malformed hit means the response
// is not the contract this client speaks, so it is reported as a failure
// rather than silently showing a shorter list.
export function parseGlobalSearchPage(value: unknown): GlobalMessageSearchPage {
  if (
    !isRecord(value) ||
    typeof value.coverageComplete !== "boolean" ||
    typeof value.coveragePaused !== "boolean" ||
    typeof value.hasMore !== "boolean" ||
    !Array.isArray(value.hits) ||
    value.hits.length > GLOBAL_SEARCH_PAGE_SIZE ||
    !(value.nextCursor === null || typeof value.nextCursor === "string") ||
    typeof value.sessionToken !== "string"
  ) {
    throw new GlobalSearchRequestError("Search results could not be loaded");
  }
  const hits: GlobalMessageSearchHit[] = [];
  for (const raw of value.hits) {
    const hit = parseGlobalSearchHit(raw);
    if (!hit) {
      throw new GlobalSearchRequestError("Search results could not be loaded");
    }
    hits.push(hit);
  }
  return {
    coverageComplete: value.coverageComplete,
    coveragePaused: value.coveragePaused,
    hasMore: value.hasMore,
    hits,
    nextCursor: value.nextCursor,
    sessionToken: value.sessionToken,
  };
}

// Retry-After as an epoch-ms deadline, capped at one minute like web.
export function retryAtFromHeader(
  header: string | null,
  now = Date.now()
): number {
  if (!header) {
    return 0;
  }
  const seconds = Number(header);
  const deadline = Number.isFinite(seconds)
    ? now + seconds * 1000
    : Date.parse(header);
  return Number.isFinite(deadline)
    ? Math.min(now + 60_000, Math.max(now, deadline))
    : 0;
}

// Web's copy for each failed status, so both clients say the same thing.
export function globalSearchErrorForStatus(
  status: number,
  retryAfter: string | null,
  now = Date.now()
): GlobalSearchRequestError {
  const retryAt = retryAtFromHeader(retryAfter, now);
  if (status === 429) {
    return new GlobalSearchRequestError(
      "Please wait a moment before searching again.",
      retryAt || now + 15_000
    );
  }
  if (status === 409) {
    return new GlobalSearchRequestError(
      "These results changed. Search again to refresh them.",
      0,
      true
    );
  }
  return new GlobalSearchRequestError(
    status === 401
      ? "Sign in again to search."
      : "Search is temporarily unavailable. Please try again.",
    retryAt
  );
}

// Appends a page while keeping at most the newest retained window, so a long
// "Load older results" session holds a bounded number of ciphertext rows.
export function mergeGlobalSearchHits(
  current: readonly GlobalMessageSearchHit[],
  incoming: readonly GlobalMessageSearchHit[],
  append: boolean
): GlobalMessageSearchHit[] {
  if (!append) {
    return [...incoming];
  }
  const seen = new Set(current.map((hit) => hit.id));
  const merged = [...current];
  for (const hit of incoming) {
    if (!seen.has(hit.id)) {
      merged.push(hit);
      seen.add(hit.id);
    }
  }
  return merged.slice(-GLOBAL_SEARCH_MAX_RETAINED_HITS);
}

export function isHitExpired(hit: GlobalMessageSearchHit, now: number) {
  return hit.expiresAt !== null && Date.parse(hit.expiresAt) <= now;
}

// The earliest future expiry among the hits, or null when none expire.
export function nextHitExpiry(
  hits: readonly GlobalMessageSearchHit[],
  now: number
): number | null {
  let earliest: number | null = null;
  for (const hit of hits) {
    if (!hit.expiresAt) {
      continue;
    }
    const at = Date.parse(hit.expiresAt);
    if (at > now && (earliest === null || at < earliest)) {
      earliest = at;
    }
  }
  return earliest;
}

type DecryptState = MessagePayload | "error" | "pending" | undefined;

// One row's preview from its decrypt state. Only text, media and post payloads
// are searchable; a payload that decrypts but no longer contains the query (an
// edit raced the index) is reported as a failed preview rather than a match.
export function buildGlobalSearchResult(
  hit: GlobalMessageSearchHit,
  entry: DecryptState,
  queryText: string
): GlobalMessageSearchResult {
  if (!entry || entry === "pending" || entry === "error") {
    return { hit, preview: null, previewFailed: entry === "error" };
  }
  if (
    entry.type !== "text" &&
    entry.type !== "media" &&
    entry.type !== "post"
  ) {
    return { hit, preview: null, previewFailed: true };
  }
  const searchable = extractSearchableText(entry);
  const [preview] = rankSearchResults(
    [
      {
        createdAt: Date.parse(hit.createdAt),
        id: hit.id,
        text: searchable.text,
      },
    ],
    queryText
  );
  return {
    hit,
    preview: preview ?? null,
    previewFailed: preview === undefined,
  };
}

export function globalSearchConversationTitle(
  hit: GlobalMessageSearchHit
): string {
  if (hit.conversationType === "DM") {
    return hit.peerName ?? hit.peerUsername ?? "Direct message";
  }
  return hit.conversationName ?? "Den";
}

// A relative path for den avatars; the caller resolves it against the API base.
export function globalSearchConversationAvatar(
  hit: GlobalMessageSearchHit
): string | null {
  if (hit.conversationType === "DM") {
    return hit.peerAvatarUrl;
  }
  return hit.conversationAvatarMediaId
    ? `/api/media/${hit.conversationAvatarMediaId}`
    : null;
}

export function globalSearchSenderLine(
  hit: GlobalMessageSearchHit,
  myUserId: string
): string {
  const sender = hit.senderId === myUserId ? "You" : hit.senderName;
  return hit.conversationType === "DEN" && hit.senderUsername
    ? `${sender} · @${hit.senderUsername}`
    : sender;
}

export function globalSearchResultLabel(
  result: GlobalMessageSearchResult,
  myUserId: string
): string {
  const sender =
    result.hit.senderId === myUserId ? "you" : result.hit.senderName;
  if (!result.preview) {
    return `Open matching message from ${sender}`;
  }
  return `Open message from ${sender} in ${globalSearchConversationTitle(result.hit)}`;
}

// Splits a ranked snippet into plain and highlighted runs, with the ellipses web
// adds when the snippet is cut from a longer message.
export function highlightSnippetParts(
  preview: RankedSearchResult
): { highlighted: boolean; text: string }[] {
  const { offset, text } = preview.snippet;
  const parts: { highlighted: boolean; text: string }[] = [];
  if (offset > 0) {
    parts.push({ highlighted: false, text: "…" });
  }
  let cursor = 0;
  for (const range of preview.ranges) {
    if (range.start > cursor) {
      parts.push({ highlighted: false, text: text.slice(cursor, range.start) });
    }
    if (range.end > cursor) {
      parts.push({
        highlighted: true,
        text: text.slice(Math.max(cursor, range.start), range.end),
      });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) {
    parts.push({ highlighted: false, text: text.slice(cursor) });
  }
  if (offset + text.length < preview.text.length) {
    parts.push({ highlighted: false, text: "…" });
  }
  return parts;
}

interface RankableProfile {
  displayName: string;
  username: string;
}

function normalizeProfileText(value: string): string {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase();
}

// Exact name or handle first, then prefix matches, then the server's order.
export function rankProfileSearchResults<T extends RankableProfile>(
  profiles: readonly T[],
  query: string
): T[] {
  const normalizedQuery = normalizeProfileText(query.trim());
  if (!normalizedQuery) {
    return [...profiles];
  }
  return orderedCopy(
    profiles.map((profile, index) => {
      const displayName = normalizeProfileText(profile.displayName);
      const username = normalizeProfileText(profile.username);
      let rank = 2;
      if (displayName === normalizedQuery || username === normalizedQuery) {
        rank = 0;
      } else if (
        displayName.startsWith(normalizedQuery) ||
        username.startsWith(normalizedQuery)
      ) {
        rank = 1;
      }
      return { index, profile, rank };
    }),
    (left, right) => left.rank - right.rank || left.index - right.index
  ).map(({ profile }) => profile);
}

export function visibleProfileResults<T>(
  profiles: readonly T[],
  expanded: boolean
): readonly T[] {
  return expanded ? profiles : profiles.slice(0, PROFILE_PREVIEW_LIMIT);
}
