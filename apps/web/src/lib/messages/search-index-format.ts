// Persistent local index for in-conversation search.
//
// The server stores only AES-GCM ciphertext, so the only place that can match
// message text is this device. Decrypted text goes into a per-conversation
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
//   keystroke cost 146MB of RAM on a 200k-message conversation, fatal on a phone.
// - Ids, metadata, and a bounded plaintext preview per row, never the full
//   message text. Full text still comes only from decrypted rows.
// - Plaintext at rest, protected by the device rather than by the app: a local
//   cache that never leaves the device, same bargain as WhatsApp, Telegram,
//   Signal, iMessage and Slack. Message payloads stay encrypted.
// - Fail-tolerant by construction. Every backend method may reject; callers read
//   a failure as "not indexed" and fall back to in-memory search.

import {
  MAX_PREFIX_EXPANSION,
  MIN_PREFIX_LENGTH,
  normalizeSearchText,
  searchQueryTokens,
} from "./message-search";
import type {
  SharedRefKind,
  SharedRefsCounts,
  SharedRefsPage,
  SharedRefsWriteRow,
} from "./shared-refs-format";

// Stamped on every record this build writes; a record carrying a different
// number reads as absent rather than being misread.
//
// Version 7 puts `createdAt` INSIDE every posting list, because ordering by row
// id was the defect it exists to fix (see the ordering note on
// `selectNewestFirstWindow`). A v6 index cannot be read by this build, so the
// write path resets the conversation and the walk rebuilds it -- the index is
// derived data and history is on the server, so no migration is needed.
export const SEARCH_INDEX_FORMAT_VERSION = 7;

// How much leading message text each indexed row keeps for the list view's
// snippets: enough for the snippet window (radius 60 each side plus the match)
// in the common case, while bounding the store to a short prefix per message.
// A match past the cutoff still resolves; its row shows the prefix without a
// highlight instead of match-centered context.
export const SEARCH_INDEX_PREVIEW_LENGTH = 200;

// A row's facts. `messageId` is stored here, once, instead of being repeated in
// every posting list. Everything but the preview is immutable; the preview
// follows the currently indexed text, so an edit rewrites it.
export interface SearchIndexRow {
  createdAt: number;
  messageId: string;
  // Leading message text, bounded by SEARCH_INDEX_PREVIEW_LENGTH. Plaintext on
  // this device, like the tokens: a short prefix so hits outside the loaded
  // window render context instead of bare ids.
  preview: string;
  senderId: string;
}

// The interned facts for one row, as a query needs them.
//
// This replaced a full per-conversation row table, which measured 76MB for a
// 200k-message conversation (4.3x the index's disk size, unsurvivable on a
// low-end phone). Resolving only the rows a query matched costs 0.2MB and does
// not grow with the conversation: O(results) instead of O(conversation).
export interface SearchIndexRowFacts {
  createdAt: number;
  messageId: string;
  preview: string;
  senderId: string;
}

export type SearchIndexRowLookup = Map<number, SearchIndexRowFacts>;

// What one query returns: the matched rows' facts, and the exact total. The
// total runs over the FULL intersection and is deliberately not capped, because
// the bar renders "n of N" and a capped N would silently under-report.
export interface SearchIndexQueryResult {
  // Whether the conversation holds matches strictly past the returned window,
  // read from the same pass that cut it, so a pager can stop without a
  // speculative read.
  hasMore: boolean;
  // Facts for the requested window only, newest first in the index's own order.
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

// Coverage bookkeeping, owned by the backfill walk. Where a page turn resumes:
// the last row of the previous window, in the index's own order.
//
// `(createdAt, row)` rather than the row id alone, and that is the whole fix. A
// row id is an ALLOCATION order, not a time order; see the ordering note on
// `selectNewestFirstWindow`. `row` is the tiebreak because timestamps collide
// (same-millisecond sends are ordinary) and an order that is not total cannot be
// keyed -- a cursor landing inside a tie group is ambiguous, which is how a
// pager starts repeating and dropping rows.
export interface SearchIndexCursor {
  createdAt: number;
  row: number;
}

export interface SearchIndexQueryOptions {
  // Keyset cursor: return only matches strictly OLDER than this one. Never "at
  // or after", so a page turn can never repeat the boundary row.
  //
  // A keyset rather than a numeric offset, which is the only other shape that
  // survives a conversation being indexed underneath it: an offset counts
  // positions in a set a backfill is still adding to, so the same offset names a
  // different message on the next read. Here the seam is a message, so a row
  // landing above the cursor while the reader is on a page cannot appear twice
  // and a row landing below it cannot be skipped.
  afterMatch?: SearchIndexCursor;
  // The word still being typed, matched by prefix against the dictionary.
  prefix?: string;
}

// Coverage bookkeeping, owned by the backfill walk.
//
// Deliberately does NOT carry the row-id allocator even though both are per-
// conversation state: the walk rewrites this object on every page and
// `putEntries` rewrites the allocator on every write, so sharing one object
// means a read-modify-write race can roll the allocator backwards and intern two
// messages to the same row id, silently corrupting each other's posting
// membership. Each backend keeps its allocator in its own private record.
export interface SearchIndexMeta {
  conversationId: string;
  // Last search or write. Eviction is least-recently-used; 0 means "never
  // touched", which sorts oldest.
  lastAccessedAt: number;
  // Newest id known to be indexed, so an interrupted walk resumes here rather
  // than restarting.
  indexedThroughId: string | null;
  pendingIds: string[];
  // True once a walk reached the oldest message, so reopening search on a
  // covered conversation does not pay a probe walk. Absent reads as false.
  reachedStart: boolean;
  // True when the cursor was written by a run that verified its way down from a
  // verified top -- every page checked or processed before the cursor advanced
  // past it. A cursor without this mark (older rows, another store version, or
  // any bulk import that reordered history) must NOT be resumed from: the next
  // run abandons it and descends from the top instead. Absent reads as false,
  // which heals legacy rows exactly once.
  //
  // Anyone building a history import/restore that inserts rows
  // non-monotonically must clear this (and reachedStart) for the conversation,
  // or the walk will keep resuming below the imported rows and never see them.
  cursorVerified: boolean;
  // True once a walk reached the oldest message AND derived that message's
  // shared refs (its media, posts and links) on the way.
  //
  // The one field here that is about the refs index rather than the text index,
  // and it exists because a verdict cannot answer a question it was never asked.
  // Refs were added after the verdict was, so a conversation indexed by an older
  // build carries `reachedStart: true` with an EMPTY refs store: the walk skips it
  // (correctly -- the text is covered) and the details pane then reports "no
  // media" for a conversation full of it, permanently. Inheriting that verdict into
  // the refs index is what produced the false answer.
  //
  // So the marker is a property of the VERDICT, not a per-row fact: it asks
  // whether the run that earned `reachedStart` was one that wrote refs. Absent
  // reads as false, which is what makes an old verdict self-heal -- the walk runs
  // once more, and the writer derives refs idempotently for every row it touches.
  // Rows it could not decrypt stay in the durable pending queue and are retried
  // through the same write path, so they are not lost and not double-counted.
  //
  // Any build that adds a new per-message artifact to the writer needs a marker
  // like this, or it inherits every verdict ever written and inherits the false
  // answer with it.
  refsReachedStart: boolean;
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
    refsReachedStart: false,
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
  // Answers a query end to end: maps typed tokens to dictionary ids,
  // intersects their posting lists, and projects the matched rows.
  //
  // One operation rather than three: a persistent backend keys posting lists by
  // dictionary id, which is not reachable through this contract, so a caller
  // cannot turn words into posting keys on its own. Separate steps would also
  // let the dictionary and posting lists come from different commits, matching
  // rows the dictionary no longer describes.
  //
  // `options.prefix` turns the trailing token into a prefix match: dictionary
  // terms starting with it are unioned, then AND-ed with the exact tokens, so
  // typing narrows live instead of flashing empty until the word completes.
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
  // pages it already indexed, and lets a run verify its resume cursor instead of
  // trusting it: a cursor pointing below uncovered history would otherwise strand
  // everything above it forever, because the walk only ever descends.
  hasIndexedMessages: (
    conversationId: string,
    messageIds: readonly string[]
  ) => Promise<ReadonlySet<string>>;
  // Rows that exist but are not searchable yet, persisted so coverage survives a
  // reload. Without this, a row that had not decrypted when last seen was queued
  // in memory only: the cursor moved past it and the queue died with the tab,
  // leaving a permanent silent hole in search.
  //
  // Whole-set rather than incremental: the writer is the single owner, so there
  // is nothing to race, and incremental add/remove would only create a second
  // consistency boundary to get wrong.
  readPending: (conversationId: string) => Promise<string[]>;
  writePending: (
    conversationId: string,
    messageIds: readonly string[]
  ) => Promise<void>;
  // Every conversation with an index on this device, oldest access first. Backs
  // LRU eviction; the meta store holds one small record per conversation, so
  // this is cheap even where a row scan would not be.
  listConversations: () => Promise<SearchIndexConversationSummary[]>;
  // One point read for the coverage label, from the allocator's high-water
  // mark: cheap and cumulative (rows ever interned) rather than a count.
  readStats: (conversationId: string) => Promise<{ indexedRowCount: number }>;
  removeEntries: (
    conversationId: string,
    messageIds: string[]
  ) => Promise<void>;
  writeMeta: (meta: SearchIndexMeta) => Promise<void>;

  // ---- shared-content refs (the details panel's Media/Posts/Links tabs) ----
  //
  // A SEPARATE index inside the same store, with its own version, its own
  // forward index, and its own counts record. It is separate so that adding refs
  // cannot invalidate a conversation's shipping text rows, and so a refs failure
  // cannot break search: `putEntries` and `putSharedRefs` are distinct
  // transactions, and a caller that loses the second still has the first.
  //
  // Every method is best-effort in the same way the rest of this contract is: a
  // rejection is read by callers as "not indexed", and the panel falls back to
  // the decrypted window it can read live.
  putSharedRefs: (
    conversationId: string,
    rows: Map<string, SharedRefsWriteRow>
  ) => Promise<void>;
  // One descending page of a kind, newest first. `options.after` is the previous
  // page's cursor, which the caller gets back as the next `after`.
  readSharedRefs: (
    conversationId: string,
    kind: SharedRefKind,
    options?: { after?: string; limit: number }
  ) => Promise<SharedRefsPage>;
  // Per-kind totals, so a tab can label itself without reading a page. Absent
  // means "nothing stored", which is the same thing as zero for a label.
  readSharedRefsCounts: (
    conversationId: string
  ) => Promise<SharedRefsCounts | null>;
  removeSharedRefs: (
    conversationId: string,
    messageIds: string[]
  ) => Promise<void>;
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

// A posting list that can grow in place, with each row's creation time carried
// alongside it.
//
// The obvious implementation is quadratic: a typed array cannot grow, so
// "insert a row" means "copy the whole list". For a token appearing in 80k
// messages that copies 80k rows per message containing it (measured 1,679
// msgs/s instead of 20,700). Spare capacity plus a used length turns the common
// append into a pointer bump.
//
// `sorted` records whether the used prefix of `values` ascends. Row ids are
// handed out in insertion order, so the common case stays sorted for free; a
// backfill interleaved with live traffic or a removal clears the flag and the
// next read sorts once.
//
// `times` is why this is a v7 record: ordering a page by row id assumed row ids
// ascend with message age, and they do not. The backfill descends from the
// newest page, so LOW row ids are the NEWEST messages (measured on the 200k
// fixture: row 975 newest, row 44416 oldest -- exactly inverted). Carrying the
// time makes the ordering key a fact about the message instead of an artefact
// of the order this device indexed it in, and it costs one float per posting
// rather than a second read: a query needing a second pass to learn its
// candidates' times would pay one point read per match, the O(matches) cost
// this design exists to keep off the keystroke path.
export interface SearchIndexRowList {
  length: number;
  sorted: boolean;
  // Creation time per row, parallel to `values`. Same used-prefix discipline:
  // only `[0, length)` is meaningful.
  times: Float64Array;
  values: Uint32Array;
}

// One list as a reader gets it: the rows, and the time each was created.
export interface SearchIndexPostingList {
  rows: Uint32Array;
  times: Float64Array;
}

// A matched row with its creation time: the unit the query sorts and windows,
// so ordering never touches the row table.
export interface SearchIndexPostingMatch {
  createdAt: number;
  row: number;
}

const MINIMUM_CAPACITY = 16;

export function emptySearchIndexRowList(): SearchIndexRowList {
  return {
    length: 0,
    sorted: true,
    times: new Float64Array(0),
    values: new Uint32Array(0),
  };
}

// Wraps a stored list, copying it into a growable buffer. Used when reading an
// existing list back out of storage before adding to it.
//
// A stored list whose two arrays disagree in length is UNUSABLE: the only way
// they disagree is a write that died between them, and guessing which half is
// authoritative is how a posting list attributes one row's time to another. An
// empty list costs a re-index; a wrong one costs wrong results.
export function searchIndexRowListFrom(
  stored: SearchIndexPostingList
): SearchIndexRowList {
  const used = Math.min(stored.rows.length, stored.times.length);
  const list: SearchIndexRowList = {
    length: used,
    sorted: true,
    times: new Float64Array(used),
    values: new Uint32Array(used),
  };
  list.values.set(stored.rows.subarray(0, used), 0);
  list.times.set(stored.times.subarray(0, used), 0);
  for (let index = 1; index < used; index += 1) {
    if ((list.values[index] ?? 0) < (list.values[index - 1] ?? 0)) {
      list.sorted = false;
      break;
    }
  }
  return list;
}

function reserve(list: SearchIndexRowList, needed: number): void {
  if (list.values.length >= needed && list.times.length >= needed) {
    return;
  }
  const capacity = Math.max(MINIMUM_CAPACITY, needed, list.values.length * 2);
  const grownValues = new Uint32Array(capacity);
  const grownTimes = new Float64Array(capacity);
  grownValues.set(list.values.subarray(0, list.length), 0);
  grownTimes.set(list.times.subarray(0, list.length), 0);
  list.values = grownValues;
  list.times = grownTimes;
}

// Adds a row with its creation time. A row already present is ignored, so a
// retried batch cannot duplicate an entry.
//
// The duplicate scan is skipped for appends, which is the whole write path: an
// append means the row is greater than every value already held, so it cannot
// be one of them. Scanning unconditionally made every add O(n) and put the 200k
// backfill at 11,338 msgs/s instead of 20,700.
export function rowListAdd(
  list: SearchIndexRowList,
  row: number,
  createdAt: number
): void {
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
  list.times[list.length] = createdAt;
  list.length += 1;
}

// Removes a row, if present. Removing from a sorted list leaves it sorted.
export function rowListRemove(list: SearchIndexRowList, row: number): void {
  const at = list.values.subarray(0, list.length).indexOf(row);
  if (at === -1) {
    return;
  }
  // Shift the tail down over the hole, in BOTH arrays: a list whose times no
  // longer line up with its rows attributes a message's time to its neighbour,
  // and the pager would order by a time belonging to something else. Removals
  // are rare and off the interaction path, so a copy-free shift is right.
  if (at + 1 < list.length) {
    list.values.copyWithin(at, at + 1, list.length);
    list.times.copyWithin(at, at + 1, list.length);
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
    list.times[kept] = list.times[index] ?? 0;
    kept += 1;
  }
  list.length = kept;
}

// The exact-length arrays a reader gets, sorted ascending. The only place a
// posting list is copied, once per query per token.
export function rowListToArrays(
  list: SearchIndexRowList
): SearchIndexPostingList {
  if (!list.sorted) {
    // Sorted as PAIRS. Sorting rows alone would leave every time beside the
    // wrong row: the values would look right while the order was silently wrong.
    const order = [...list.values.subarray(0, list.length).keys()].toSorted(
      (left, right) => (list.values[left] ?? 0) - (list.values[right] ?? 0)
    );
    const values = new Uint32Array(order.length);
    const times = new Float64Array(order.length);
    for (let index = 0; index < order.length; index += 1) {
      const from = order[index] ?? 0;
      values[index] = list.values[from] ?? 0;
      times[index] = list.times[from] ?? 0;
    }
    list.values = values;
    list.times = times;
    list.sorted = true;
  }
  return {
    rows: list.values.slice(0, list.length),
    times: list.times.slice(0, list.length),
  };
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
export function unionPostingLists(
  lists: readonly SearchIndexPostingList[]
): SearchIndexPostingList {
  // Keyed by row rather than deduped by position: a row's time must travel
  // WITH it, and pairing row ids from one list with times from another would
  // not. The first occurrence is as good as any -- they agree.
  const createdAtByRow = new Map<number, number>();
  for (const list of lists) {
    for (let index = 0; index < list.rows.length; index += 1) {
      const row = list.rows[index] ?? 0;
      if (!createdAtByRow.has(row)) {
        createdAtByRow.set(row, list.times[index] ?? 0);
      }
    }
  }
  const rows = [...createdAtByRow.keys()].toSorted(
    (left, right) => left - right
  );
  // Both arrays filled in one pass: the pairing is the whole invariant here.
  const values = new Uint32Array(rows.length);
  const times = new Float64Array(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? 0;
    values[index] = row;
    times[index] = createdAtByRow.get(row) ?? 0;
  }
  return { rows: values, times };
}

// Intersects several posting lists, with an exact total, carrying each matched
// row's creation time out with it.
//
// Each pass scans one list once and tests membership in a Map of the survivors,
// so cost is the sum of the list lengths rather than their product. The rarest
// list leads, bounding candidates immediately. Computed in full because
// `totalMatched` drives the result counter; capping the scan would under-report.
//
// No ordering and no windowing happens here, and that is deliberate: ordering
// belongs on the message's own time (`times` rides in the posting list, see
// `SearchIndexRowList`), done by `selectNewestFirstWindow`. Ordering by row id
// instead was wrong because row ids are allocation order, not age: this backfill
// descends from the NEWEST page, so LOW row ids are the NEWEST messages
// (measured on the 200k fixture: row 975 newest, row 44416 oldest). That
// inversion made the capped head take the OLDEST matches and made keyset paging
// walk toward older rows until every page after the head came back empty.
// Intersecting still yields candidates in row-id order because that is what the
// lists are stored in, and sorting them is free: O(matches log matches) on what
// the user matched, not on the conversation.
export function intersectPostingLists(
  lists: readonly SearchIndexPostingList[]
): { matches: SearchIndexPostingMatch[]; totalMatched: number } {
  if (lists.length === 0) {
    return { matches: [], totalMatched: 0 };
  }
  for (const list of lists) {
    // A word with no matches short-circuits the whole query, which is what makes
    // a typo instant rather than a scan of the common token's list.
    if (list.rows.length === 0) {
      return { matches: [], totalMatched: 0 };
    }
  }
  const [smallest, ...larger] = [...lists].toSorted(
    (left, right) => left.rows.length - right.rows.length
  );
  if (!smallest) {
    return { matches: [], totalMatched: 0 };
  }
  let candidates: SearchIndexPostingMatch[] = [];
  for (let index = 0; index < smallest.rows.length; index += 1) {
    const row = smallest.rows[index] ?? 0;
    candidates.push({ createdAt: smallest.times[index] ?? 0, row });
  }
  for (const list of larger) {
    if (candidates.length === 0) {
      break;
    }
    // Membership by row id, built once per pass. A row's time is a property
    // of the row, so taking it from the smallest list is as good as any, and
    // an intersection cannot invent a time no list agrees on.
    const allowed = new Map<number, number>();
    for (let index = 0; index < list.rows.length; index += 1) {
      const row = list.rows[index] ?? 0;
      allowed.set(row, list.times[index] ?? 0);
    }
    candidates = candidates.filter((match) => allowed.has(match.row));
  }
  return { matches: candidates, totalMatched: candidates.length };
}

// The index's display order: newest first, with the row id as the tiebreak.
//
// The row id only exists to make the order TOTAL: same-millisecond sends are
// ordinary, an order that is not total cannot be keyed, and a cursor landing
// inside a tie group is ambiguous, which makes a pager repeat and drop rows.
// Row id is stable and unique, so `(createdAt, row)` is a total order and a
// keyset over it is exact.
//
// Note this tiebreak is the row id while the list view's own comparator breaks
// ties on the message id. They can only disagree inside a same-millisecond group
// a page boundary falls through, and only on position among messages the reader
// cannot tell apart -- each row still appears exactly once. Making them
// identical would mean carrying every candidate's message id into the ordering
// pass, the O(matches) row resolution this design avoids.
function compareNewestFirst(
  left: SearchIndexPostingMatch | SearchIndexCursor,
  right: SearchIndexPostingMatch | SearchIndexCursor
): number {
  if (left.createdAt !== right.createdAt) {
    return right.createdAt - left.createdAt;
  }
  return left.row - right.row;
}

// One page of matches, and whether the conversation has any past it. `hasMore`
// lets a pager stop without a speculative extra read -- inferring "no more
// pages" from an empty page cost a wasted round trip and a visible loading
// state on every last page.
export function selectNewestFirstWindow(
  matches: readonly SearchIndexPostingMatch[],
  limit: number,
  afterMatch?: SearchIndexCursor
): { hasMore: boolean; window: SearchIndexPostingMatch[] } {
  if (matches.length === 0 || limit <= 0) {
    return { hasMore: false, window: [] };
  }
  const ordered = [...matches].toSorted(compareNewestFirst);
  // Strictly past the cursor: the boundary is EXCLUDED so a page turn can never
  // repeat it, and the total order means no match can fall between two pages.
  const start =
    afterMatch === undefined
      ? 0
      : ordered.findIndex((match) => compareNewestFirst(match, afterMatch) > 0);
  if (afterMatch !== undefined && start === -1) {
    // Everything is at or above the cursor: this is the page past the last match.
    return { hasMore: false, window: [] };
  }
  const from = Math.max(0, start);
  const end = Math.min(from + limit, ordered.length);
  return { hasMore: end < ordered.length, window: ordered.slice(from, end) };
}

// The cursor a window ends on, for the page below it. Null for an empty window,
// so a page past the last match cannot silently re-serve the previous one.
export function windowCursor(
  window: readonly SearchIndexPostingMatch[]
): SearchIndexCursor | null {
  const last = window.at(-1);
  return last ? { createdAt: last.createdAt, row: last.row } : null;
}
