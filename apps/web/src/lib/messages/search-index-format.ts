// Persistent local index for in-conversation search.
//
// The server stores only AES-GCM ciphertext, so the only place that can match
// message text is this device. To search a whole conversation rather than the
// few thousand rows in memory, decrypted text is written into a per-conversation
// inverted index (token -> message rows) that survives reloads.
//
// Design notes, each a deliberate choice:
//
// - Inverted, not a flat list. A query intersects posting lists, so cost scales
//   with matches rather than history length.
// - Row ids, not message ids, inside posting lists. A cuid2 message id is ~25
//   characters, and repeating it once per word made the index *larger than the
//   messages it indexes* (measured: 112MB vs 94MB for 200k messages). Interning
//   to a small integer per conversation cuts that 4.8x, to 23MB. Message ids live
//   once, in the conversation's row table.
// - Read per token, not the whole index. Loading every posting list on the first
//   keystroke cost 146MB of RAM on a 200k-message conversation, which is fatal on
//   a phone. A query now reads only the words that were typed.
// - Ids and metadata only, never message text. The index answers "which
//   messages match"; snippets and sender details come from the decrypted rows,
//   so plaintext is never written to a second long-lived store.
// - Portable-ready serialization. Versioned records with stable field order and
//   a merge-friendly cursor in meta, so this can later ship between devices as
//   opaque encrypted blobs without a rewrite.
// - Fail-tolerant by construction. Every backend method may reject; callers read
//   a failure as "not indexed" and fall back to in-memory search.

import { normalizeSearchText, searchQueryTokens } from "./message-search";

// The packed token-id width changed; existing indexes are dropped and rebuilt by walking history.
export const SEARCH_INDEX_FORMAT_VERSION = 4;

// A row's immutable facts. `messageId` is stored here, once, instead of being
// repeated in every posting list.
export interface SearchIndexRow {
  createdAt: number;
  messageId: string;
  senderId: string;
}

// The interned facts for one row, as a query needs them.
//
// This replaced a full per-conversation row table. That table was the single
// largest memory cost in the design: holding every message id as a string plus a
// reverse Map measured 76MB for a 200k-message conversation, which is 4.3x the
// index's size on disk and unsurvivable on a low-end phone. Resolving only the
// rows a query actually matched costs 0.2MB and does not grow with the
// conversation, so the read is now O(results) instead of O(conversation).
export interface SearchIndexRowFacts {
  createdAt: number;
  messageId: string;
  senderId: string;
}

export type SearchIndexRowLookup = Map<number, SearchIndexRowFacts>;

// What one query returns: the matched rows' facts, and the exact total. The total
// is computed over the full intersection and is deliberately not capped, because
// the bar renders "n of N" and a capped N would silently under-report.
export interface SearchIndexQueryResult {
  rows: SearchIndexRowLookup;
  totalMatched: number;
}

// What eviction needs to know about a conversation without reading its rows.
export interface SearchIndexConversationSummary {
  conversationId: string;
  indexedRowCount: number;
  lastAccessedAt: number;
}

// Interned row bookkeeping, held only by the in-memory backends where the whole
// conversation is already resident. A persistent backend keeps no equivalent
// structure: it stores rows by id and resolves them on demand.
export interface SearchIndexRowTable {
  createdAtByRow: number[];
  messageIdByRow: string[];
  rowsByMessageId: Map<string, number>;
  senderIdByRow: string[];
}

export function emptySearchIndexRowTable(): SearchIndexRowTable {
  return {
    createdAtByRow: [],
    messageIdByRow: [],
    rowsByMessageId: new Map(),
    senderIdByRow: [],
  };
}

// Coverage bookkeeping, owned by the backfill walk.
//
// Deliberately does NOT carry the row-id allocator even though both are per-
// conversation state. The walk rewrites this whole object on every page, and
// `putEntries` rewrites it on every write; sharing one object between them means
// a read-modify-write race can roll the allocator backwards, and two messages
// would then be interned to the same row id and silently corrupt each other's
// posting membership. Each backend keeps its allocator in its own private record
// instead, so the two writers never touch the same object.
export interface SearchIndexMeta {
  conversationId: string;
  // When this conversation's index was last searched or written. Eviction is
  // least-recently-used, so a conversation nobody has touched in months is the
  // first to go. Zero means "never touched", which sorts oldest.
  lastAccessedAt: number;
  // Newest id known to be indexed. History walks advance it as they commit, so
  // an interrupted walk resumes here rather than restarting.
  indexedThroughId: string | null;
  pendingIds: string[];
  updatedAt: number;
  version: number;
}

export function emptySearchIndexMeta(conversationId: string): SearchIndexMeta {
  return {
    conversationId,
    indexedThroughId: null,
    lastAccessedAt: 0,
    pendingIds: [],
    updatedAt: 0,
    version: SEARCH_INDEX_FORMAT_VERSION,
  };
}

// Entries as handed to the write path, before interning.
export interface SearchIndexEntry {
  createdAt: number;
  senderId: string;
  tokens: string[];
}

export interface SearchIndexStore {
  clearConversation: (conversationId: string) => Promise<void>;
  // One transaction for the whole batch. Per-entry transactions are the
  // difference between indexing a conversation in seconds and in minutes, and
  // must be idempotent per message id so a retried batch cannot duplicate.
  putEntries: (
    conversationId: string,
    entries: Map<string, SearchIndexEntry>
  ) => Promise<void>;
  readMeta: (conversationId: string) => Promise<SearchIndexMeta | null>;
  // Answers a query end to end: maps the typed tokens to the table's internal
  // token ids, intersects their posting lists, and projects the matched rows.
  //
  // One operation rather than three, for two reasons that only appear once the
  // table is sealed. The token dictionary lives INSIDE the ciphertext, so a
  // caller cannot turn words into posting keys at all without the table in hand.
  // And doing the steps separately would let the table and the posting lists come
  // from different commits, producing results that match rows the table no longer
  // contains. A single call bounds both: one AEAD operation and one consistent
  // revision per keystroke.
  query: (
    conversationId: string,
    tokens: string[],
    limit: number
  ) => Promise<SearchIndexQueryResult>;
  // Reads every token at once, keyed by token TEXT. Used by tests and by
  // whole-index operations (eviction accounting), never by the keystroke path,
  // which goes through `query`.
  readAllPostingLists: (
    conversationId: string
  ) => Promise<Map<string, Uint32Array>>;
  // Resolves specific rows. Used by tests and by whole-table operations, never by
  // the keystroke path.
  readRows: (
    conversationId: string,
    rowIds: Uint32Array
  ) => Promise<SearchIndexRowLookup>;
  // Rows that exist but are not searchable yet, persisted so coverage survives a
  // reload. Without this, a row whose payload had not decrypted when it was last
  // seen was queued in memory only: the backfill cursor moved past it and the
  // queue died with the tab, leaving a permanent silent hole in search.
  //
  // Whole-set rather than incremental, because the writer is the single owner and
  // therefore the only writer, so there is nothing to race. Incremental add and
  // remove would only create a second consistency boundary to get wrong.
  readPending: (conversationId: string) => Promise<string[]>;
  writePending: (
    conversationId: string,
    messageIds: readonly string[]
  ) => Promise<void>;
  // Every conversation with an index on this device, oldest access first. Backs
  // least-recently-used eviction. The meta store holds one small record per
  // conversation, so this is cheap even where a row scan would not be.
  listConversations: () => Promise<SearchIndexConversationSummary[]>;
  // One point read, for the coverage label. It comes from the allocator's
  // high-water mark, so it is cheap and cumulative: it reports rows ever interned
  // rather than decrypting the full table for a count.
  readStats: (conversationId: string) => Promise<{ indexedRowCount: number }>;
  removeEntries: (
    conversationId: string,
    messageIds: string[]
  ) => Promise<void>;
  writeMeta: (meta: SearchIndexMeta) => Promise<void>;
}

// ---- shared logic ----------------------------------------------------------

// Builds an entry from a decrypted payload's searchable text. Returns null when
// there is nothing to match, so an empty posting entry is never stored.
export function buildSearchIndexEntry(input: {
  createdAt: number;
  senderId: string;
  text: string;
}): SearchIndexEntry | null {
  const tokens = [
    ...new Set(searchQueryTokens(normalizeSearchText(input.text))),
  ].toSorted();
  if (tokens.length === 0) {
    return null;
  }
  return {
    createdAt: input.createdAt,
    senderId: input.senderId,
    tokens,
  };
}

// Interns message ids into dense row ids, assigning new ones on first sight.
export function internRows(
  table: SearchIndexRowTable,
  entries: Map<string, SearchIndexEntry>
): { newRows: number[]; tokensByRow: Map<number, string[]> } {
  const newRows: number[] = [];
  const tokensByRow = new Map<number, string[]>();
  for (const [messageId, entry] of entries) {
    let row = table.rowsByMessageId.get(messageId);
    if (row === undefined) {
      row = table.messageIdByRow.length;
      table.messageIdByRow.push(messageId);
      table.createdAtByRow.push(entry.createdAt);
      table.senderIdByRow.push(entry.senderId);
      table.rowsByMessageId.set(messageId, row);
      newRows.push(row);
    }
    tokensByRow.set(row, entry.tokens);
  }
  return { newRows, tokensByRow };
}

// A posting list that can grow in place.
//
// This exists because the obvious implementation is quadratic. A posting list is
// a typed array, and a typed array cannot grow, so "insert a row" means "copy the
// whole list". For a token that appears in 80k messages, indexing a conversation
// copies 80k rows for every message that contains the token: measured at 200k
// messages, 1,679 msgs/s instead of 20,700. Holding spare capacity and tracking
// the used length turns the common append into a pointer bump.
//
// `sorted` records whether the used prefix is ascending. Row ids are handed out
// in insertion order and messages are usually indexed oldest-first, so the common
// case stays sorted for free; a backfill that interleaves with live traffic, or a
// removal, just clears the flag and the next read sorts once.
export interface SearchIndexRowList {
  length: number;
  sorted: boolean;
  values: Uint32Array;
}

const MINIMUM_CAPACITY = 16;

export function emptySearchIndexRowList(): SearchIndexRowList {
  return { length: 0, sorted: true, values: new Uint32Array(0) };
}

// Wraps a stored list, copying it into a growable buffer. Used when reading an
// existing list back out of storage before adding to it.
export function searchIndexRowListFrom(
  values: Uint32Array
): SearchIndexRowList {
  const list: SearchIndexRowList = {
    length: values.length,
    sorted: true,
    values: new Uint32Array(values.length),
  };
  list.values.set(values, 0);
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] ?? 0) < (values[index - 1] ?? 0)) {
      list.sorted = false;
      break;
    }
  }
  return list;
}

function reserve(list: SearchIndexRowList, needed: number): void {
  if (list.values.length >= needed) {
    return;
  }
  const capacity = Math.max(MINIMUM_CAPACITY, needed, list.values.length * 2);
  const grown = new Uint32Array(capacity);
  grown.set(list.values.subarray(0, list.length), 0);
  list.values = grown;
}

// Adds a row. A row already present is ignored, so a retried batch cannot
// duplicate an entry.
//
// The duplicate scan is skipped for appends, which is the whole write path: an
// append means the row is greater than every value already held, so it cannot be
// one of them. Scanning unconditionally made every add O(n) and put the 200k
// backfill at 11,338 msgs/s instead of 20,700.
export function rowListAdd(list: SearchIndexRowList, row: number): void {
  const isAppend =
    list.length === 0 || row > (list.values[list.length - 1] ?? -1);
  if (!isAppend) {
    if (list.values.subarray(0, list.length).includes(row)) {
      return;
    }
    list.sorted = false;
  }
  reserve(list, list.length + 1);
  list.values[list.length] = row;
  list.length += 1;
}

// Removes a row, if present. Removing from a sorted list leaves it sorted.
export function rowListRemove(list: SearchIndexRowList, row: number): void {
  const at = list.values.subarray(0, list.length).indexOf(row);
  if (at === -1) {
    return;
  }
  // Shift the tail down over the hole. Removals are rare (delete, hide) and off
  // the interaction path, unlike writes, so a copy-free shift is the right trade.
  if (at + 1 < list.length) {
    list.values.copyWithin(at, at + 1, list.length);
  }
  list.length -= 1;
}

// Removes many rows in one pass. A bulk hide or delete calls this instead of
// rowListRemove per row, which would rescan the list for every row removed.
export function rowListRemoveMany(
  list: SearchIndexRowList,
  rows: ReadonlySet<number>
): void {
  if (rows.size === 0) {
    return;
  }
  let kept = 0;
  for (let index = 0; index < list.length; index += 1) {
    const row = list.values[index] ?? 0;
    if (rows.has(row)) {
      continue;
    }
    list.values[kept] = row;
    kept += 1;
  }
  list.length = kept;
}

// The exact-length array a reader gets, sorted ascending. This is the only place
// a posting list is copied, and it happens once per query per token.
export function rowListToArray(list: SearchIndexRowList): Uint32Array {
  if (!list.sorted) {
    const values = list.values.subarray(0, list.length).toSorted();
    list.values.set(values, 0);
    list.sorted = true;
  }
  return list.values.slice(0, list.length);
}

// Newest matches a single query returns. The bar shows "n of N", so the *count*
// is always exact no matter how many matches there are; this cap only bounds how
// many rows get resolved and rendered.
export const SEARCH_INDEX_QUERY_LIMIT = 2000;

// Intersects several posting lists, with an exact total.
//
// Each pass scans one list once and tests membership in a Set of the rows that
// survived so far, so the cost is the sum of the list lengths rather than their
// product. The rarest list leads, which bounds the candidate set immediately.
//
// The intersection is computed in full because `totalMatched` drives the result
// counter; capping the scan would silently under-report it.
//
// Returns the rows matching every list, capped at `limit`.
//
// Ordering: descending row id, which is newest-indexed-first, because row ids are
// handed out in insertion order and a conversation is normally indexed oldest
// first. Timestamps are deliberately NOT used here. The caller cannot know which
// rows survived until this returns, and resolving timestamps for the whole
// conversation to sort a capped result is what made search memory grow with the
// conversation. So this returns the capped set and the caller reorders those few
// rows once it has resolved their facts — exact for a chronologically indexed
// conversation, and for a backfill interleaved with live traffic it may keep a
// slightly different slice of a query matching more than `limit` messages.
export function intersectPostingLists(
  lists: Uint32Array[],
  limit: number
): { rows: number[]; totalMatched: number } {
  if (lists.length === 0 || limit <= 0) {
    return { rows: [], totalMatched: 0 };
  }
  for (const list of lists) {
    // A word with no matches short-circuits the whole query, which is what makes
    // a typo instant rather than a scan of the common token's list.
    if (list.length === 0) {
      return { rows: [], totalMatched: 0 };
    }
  }
  const [smallest, ...larger] = lists.toSorted(
    (left, right) => left.length - right.length
  );
  if (!smallest) {
    return { rows: [], totalMatched: 0 };
  }
  let candidates = [...smallest];
  for (const list of larger) {
    if (candidates.length === 0) {
      break;
    }
    const allowed = new Set(candidates);
    const next: number[] = [];
    for (const row of list) {
      if (allowed.has(row)) {
        next.push(row);
      }
    }
    candidates = next;
  }
  const totalMatched = candidates.length;
  if (totalMatched === 0) {
    return { rows: [], totalMatched: 0 };
  }
  // Candidates ascend by row id, so the newest-indexed are at the end and the
  // cap is a slice rather than a sort.
  return { rows: candidates.slice(-limit).toReversed(), totalMatched };
}

// Raised when a write computed from revision N finds revision N+1 already sealed.
// The backend must re-read and recompute rather than overwrite: a table built
// from a stale read would silently drop the other writer's rows. Lives here
// rather than in the IndexedDB backend so the revision semantics and the error
// that reports them stay in one file.
export class SearchIndexRevisionConflictError extends Error {
  constructor(conversationId: string) {
    super(`search index revision conflict for ${conversationId}`);
    this.name = "SearchIndexRevisionConflictError";
  }
}
