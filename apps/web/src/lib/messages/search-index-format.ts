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
//   once, in the conversation's rows.
// - Read per token, not the whole index. Loading every posting list on the first
//   keystroke cost 146MB of RAM on a 200k-message conversation, which is fatal on
//   a phone. A query now reads only the words that were typed.
// - Ids, metadata, and a bounded plaintext preview per row, never the full
//   message text. The index answers "which messages match" and the list view
//   renders each hit's context from the preview without loading (or being
//   able to decrypt) the row; snippets and highlight ranges are built from it
//   at read time. Full text still comes only from decrypted rows, so the
//   long-lived store holds at most a short prefix per message rather than the
//   conversation.
// - Plaintext at rest, protected by the device rather than by the app. This is a
//   local cache that never leaves the device and that the server holds no copy
//   of, so its at-rest protection is the OS and the device lock — the same
//   bargain WhatsApp, Telegram, Signal, iMessage and Slack make. Message
//   payloads remain encrypted exactly as they are.
// - Fail-tolerant by construction. Every backend method may reject; callers read
//   a failure as "not indexed" and fall back to in-memory search.

import {
  MAX_PREFIX_EXPANSION,
  MIN_PREFIX_LENGTH,
  normalizeSearchText,
  searchQueryTokens,
} from "./message-search";

// Stamped on every record this build writes, and the guard for reading one back:
// a record carrying a different number is treated as absent rather than
// misread. The stored row record changed shape when the row table went back to
// one record per row, and existing indexes are dropped and rebuilt by walking
// history.
export const SEARCH_INDEX_FORMAT_VERSION = 6;

// How much leading message text each indexed row keeps for the list view's
// snippets. Enough for the snippet window (radius 60 each side plus the match)
// in the overwhelmingly common case -- chat messages are short -- while bounding
// the store to a short prefix per message rather than the conversation. A match
// past the cutoff still resolves (postings are unaffected); its row just shows
// the prefix without a highlight instead of match-centered context.
export const SEARCH_INDEX_PREVIEW_LENGTH = 200;

// A row's facts. `messageId` is stored here, once, instead of being
// repeated in every posting list. Everything but the preview is immutable;
// the preview follows the currently indexed text, so an edit rewrites it.
export interface SearchIndexRow {
  createdAt: number;
  messageId: string;
  // Leading message text, bounded by SEARCH_INDEX_PREVIEW_LENGTH, for the list
  // view's snippets. Plaintext on this device, like the tokens: the tradeoff
  // the local index already makes, extended from vocabulary to a short prefix
  // so hits outside the loaded window render context instead of bare ids.
  preview: string;
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
  preview: string;
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
  previewByRow: string[];
  rowsByMessageId: Map<string, number>;
  senderIdByRow: string[];
}

export function emptySearchIndexRowTable(): SearchIndexRowTable {
  return {
    createdAtByRow: [],
    messageIdByRow: [],
    previewByRow: [],
    rowsByMessageId: new Map(),
    senderIdByRow: [],
  };
}

// Coverage bookkeeping, owned by the backfill walk.
//
// Deliberately does NOT carry the row-id allocator even though both are per-
// conversation state. The walk rewrites this whole object on every page, and
// `putEntries` rewrites the allocator on every write; sharing one object between
// them means a read-modify-write race can roll the allocator backwards, and two
// messages would then be interned to the same row id and silently corrupt each
// other's posting membership. Each backend keeps its allocator in its own private
// record instead, so the two writers never touch the same object.
export interface SearchIndexQueryOptions {
  // Keyset cursor for paging past the rows a previous window returned: only
  // rows with a SMALLER id are considered, because the query orders descending
  // (newest-indexed first). Strictly "less than", never "at or after", so a
  // page turn can never repeat the boundary row.
  //
  // A keyset rather than a numeric offset because the order is an approximation
  // (row ids are handed out in insertion order, `createdAt` is only resolved for
  // a capped window), and the caller's displayed head is re-sorted by real
  // timestamps. A numeric offset would count positions in the index's order while
  // the seam between page one and page two sits in the caller's re-sorted order,
  // which can duplicate or skip rows exactly at the seam. The keyset follows the
  // index's own order, so the seam is exact whatever the caller does with the rows
  // it already has.
  afterRowId?: number;
  // The word still being typed, matched by prefix against the dictionary.
  prefix?: string;
}

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
  // True once a walk reached the oldest message. Persisted so reopening search
  // on a covered conversation does not pay a probe walk just to rediscover it.
  // Absent (from before this field existed) reads as false.
  reachedStart: boolean;
  // True when the cursor above was written by a run that verified its way down
  // from a verified top -- every page checked or processed before the cursor
  // advanced past it. A cursor without this mark (older rows, another store
  // version, or any bulk import that reordered history) must NOT be resumed
  // from: the next run abandons it and descends from the top instead. Absent
  // reads as false, which heals legacy rows exactly once.
  //
  // Anyone building a history import/restore that inserts rows non-monotonically
  // must clear this (and reachedStart) for the conversation, or the walk will
  // keep resuming below the imported rows and never see them.
  cursorVerified: boolean;
  updatedAt: number;
  version: number;
}

export function emptySearchIndexMeta(conversationId: string): SearchIndexMeta {
  return {
    conversationId,
    cursorVerified: false,
    indexedThroughId: null,
    lastAccessedAt: 0,
    pendingIds: [],
    reachedStart: false,
    updatedAt: 0,
    version: SEARCH_INDEX_FORMAT_VERSION,
  };
}

// Entries as handed to the write path, before interning.
export interface SearchIndexEntry {
  createdAt: number;
  preview: string;
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
  // Answers a query end to end: maps the typed tokens to the conversation's token
  // dictionary ids, intersects their posting lists, and projects the matched rows.
  //
  // One operation rather than three, for one reason: a persistent backend keys its
  // posting lists by dictionary id, and the dictionary is not reachable through
  // the store contract, so a caller cannot turn words into posting keys at all on
  // its own. Doing the steps separately would also let the dictionary and the
  // posting lists come from different commits, producing results that match rows
  // the dictionary no longer describes. One call bounds both per keystroke.
  //
  // `options.prefix` turns the trailing token into a prefix match: dictionary
  // terms starting with it are unioned, then AND-ed with the exact tokens. This
  // is what makes typing narrow live instead of flashing empty until the word
  // is complete.
  query: (
    conversationId: string,
    tokens: string[],
    limit: number,
    options?: SearchIndexQueryOptions
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
  // The subset of the given message ids that already occupy a row, present or
  // tombstoned -- both mean "covered, nothing left to do". Lets a walk skip
  // pages it already indexed without decrypting or committing them, and --
  // more importantly -- lets a run verify its resume cursor instead of
  // trusting it. A cursor pointing below uncovered history (new arrivals above
  // it, a stale row from another era or store version) would otherwise strand
  // everything above it forever, because the walk only ever descends.
  hasIndexedMessages: (
    conversationId: string,
    messageIds: readonly string[]
  ) => Promise<ReadonlySet<string>>;
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
  // rather than counting the conversation for a label.
  readStats: (conversationId: string) => Promise<{ indexedRowCount: number }>;
  removeEntries: (
    conversationId: string,
    messageIds: string[]
  ) => Promise<void>;
  writeMeta: (meta: SearchIndexMeta) => Promise<void>;
}

// ---- shared logic ----------------------------------------------------------

// Builds an entry from a decrypted payload's searchable text. Returns null when
// there is nothing to match, so an empty posting entry is never stored. The
// preview is a code-point-safe leading slice: cutting a surrogate pair would
// store a lone surrogate that renders as a replacement character in the list.
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
    preview: [...input.text].slice(0, SEARCH_INDEX_PREVIEW_LENGTH).join(""),
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
      table.previewByRow.push(entry.preview);
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

// Resolves a trailing prefix against the dictionary: every indexed term that
// starts with it. Short fragments fan out only to the word itself (so single
// characters keep working exactly as before, never as prefix searches), and an
// expansion wider than the cap matches NOTHING rather than a capped subset --
// a capped union would under-report the total, and the counter prints totals,
// so partial is a lie while empty is just unhelpful for one more keystroke.
export function expandPrefixTerm(
  dictionary: readonly string[],
  prefix: string
): string[] {
  if (prefix.length < MIN_PREFIX_LENGTH) {
    return dictionary.includes(prefix) ? [prefix] : [];
  }
  const expansions = dictionary.filter((term) => term.startsWith(prefix));
  if (expansions.length === 0 || expansions.length > MAX_PREFIX_EXPANSION) {
    return [];
  }
  return expansions;
}

// Unions several posting lists into one sorted, de-duplicated list: the rows
// matching ANY of them. Linear in the total input length; used for prefix
// expansions, where one typed fragment fans out to several dictionary terms.
export function unionPostingLists(lists: Uint32Array[]): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const list of lists) {
    for (const row of list) {
      if (!seen.has(row)) {
        seen.add(row);
        out.push(row);
      }
    }
  }
  out.sort((left, right) => left - right);
  return Uint32Array.from(out);
}

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
// `afterRowId` pages: the caller passes the last row id it received and gets the
// next `limit` rows below it. The full intersection is still computed either way,
// so `totalMatched` is exact on every page -- the counter never depends on which
// window was asked for.
//
// Ordering: descending row id, which is newest-indexed-first, because row ids are
// handed out in insertion order and a conversation is normally indexed oldest
// first. Timestamps are deliberately NOT used here. The caller cannot know which
// rows survived until this returns, and resolving timestamps for the whole
// conversation to sort a capped result is what made search memory grow with the
// conversation. So this returns the window and the caller reorders those few rows
// once it has resolved their facts — exact for a chronologically indexed
// conversation, and for a backfill interleaved with live traffic it may keep a
// slightly different slice of a query matching more than `limit` messages.
export function intersectPostingLists(
  lists: Uint32Array[],
  limit: number,
  afterRowId?: number
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
  if (afterRowId !== undefined) {
    // The window is everything strictly below the cursor, newest-indexed first.
    // Candidates ascend, so this is a cut and a reverse -- no sort, and a page
    // past the last match is empty while `totalMatched` still reports the total.
    const remaining = candidates.filter((row) => row < afterRowId);
    return { rows: remaining.slice(-limit).toReversed(), totalMatched };
  }
  // Candidates ascend by row id, so the newest-indexed are at the end and the
  // cap is a slice rather than a sort.
  return { rows: candidates.slice(-limit).toReversed(), totalMatched };
}
