// In-memory backend for the search index.
//
// This is the test backend and the reference implementation of the store
// contract: every rule lives in search-index-format.ts (pure, tested) and in the
// contract itself, so the browser backend cannot drift from this one. Bun has no
// IndexedDB, so the logic that matters is kept out of the storage layer.

import {
  emptySearchIndexRowList,
  emptySearchIndexRowTable,
  expandPrefixTerm,
  internRows,
  intersectPostingLists,
  rowListAdd,
  rowListRemove,
  rowListToArrays,
  selectNewestFirstWindow,
  unionPostingLists,
} from "./search-index-format";
import type {
  SearchIndexConversationSummary,
  SearchIndexPostingList,
  SearchIndexMeta,
  SearchIndexRowList,
  SearchIndexRowLookup,
  SearchIndexRowTable,
  SearchIndexStore,
} from "./search-index-format";

interface ConversationIndex {
  posting: Map<string, SearchIndexRowList>;
  // Reverse index: which tokens a row appears in, so a rewrite or removal only
  // touches those lists. Without it, either operation is O(distinct tokens).
  tokensByRow: Map<number, string[]>;
  table: SearchIndexRowTable;
}

const listFor = (
  index: ConversationIndex,
  token: string
): SearchIndexRowList => {
  let list = index.posting.get(token);
  if (!list) {
    list = emptySearchIndexRowList();
    index.posting.set(token, list);
  }
  return list;
};

// Drops a row from a token's list, removing the key when nothing is left, so the
// store never holds a record that can never match again.
const removeFromToken = (
  index: ConversationIndex,
  token: string,
  row: number
) => {
  const list = index.posting.get(token);
  if (!list) {
    return;
  }
  rowListRemove(list, row);
  if (list.length === 0) {
    index.posting.delete(token);
  }
};

export function createMemorySearchIndexStore(): SearchIndexStore & {
  conversations: () => string[];
  readPostingList: (
    conversationId: string,
    token: string
  ) => Promise<Uint32Array>;
  // The creation time beside each row of a stored posting list, for the same
  // callers as `readPostingList`. Split rather than one accessor because almost
  // every caller wants only the rows.
  readPostingTimes: (
    conversationId: string,
    token: string
  ) => Promise<Float64Array>;
  // Test affordance: the live posting map, for structural assertions.
  postingFor: (conversationId: string) => Map<string, SearchIndexRowList>;
  tokenCount: (conversationId: string) => number;
} {
  const byConversation = new Map<string, ConversationIndex>();
  // Per store instance: two stores in one process must not share meta, or a test
  // would see another store's conversation state.
  const metaByConversation = new Map<string, SearchIndexMeta>();
  const pendingByConversation = new Map<string, string[]>();

  const indexFor = (conversationId: string): ConversationIndex => {
    let index = byConversation.get(conversationId);
    if (!index) {
      index = {
        posting: new Map(),
        table: emptySearchIndexRowTable(),
        tokensByRow: new Map(),
      };
      byConversation.set(conversationId, index);
    }
    return index;
  };

  return {
    clearConversation(conversationId) {
      byConversation.delete(conversationId);
      // Meta lives in its own map, so it has to be dropped explicitly: leaving
      // it behind would report an "indexed through" cursor for a conversation
      // with no rows, and the next backfill would skip straight past the gap.
      metaByConversation.delete(conversationId);
      pendingByConversation.delete(conversationId);
      return Promise.resolve();
    },

    conversations() {
      return [...byConversation.keys()];
    },

    hasIndexedMessages(conversationId, messageIds) {
      const { table } = indexFor(conversationId);
      const out = new Set<string>();
      for (const id of messageIds) {
        // Present or tombstoned alike: the forward map keeps both, and both
        // mean the walk has nothing left to do for the id.
        if (table.rowsByMessageId.has(id)) {
          out.add(id);
        }
      }
      return Promise.resolve(out);
    },

    listConversations() {
      const out: SearchIndexConversationSummary[] = [];
      for (const [conversationId, index] of byConversation) {
        out.push({
          conversationId,
          indexedRowCount: index.table.messageIdByRow.length,
          lastAccessedAt:
            metaByConversation.get(conversationId)?.lastAccessedAt ?? 0,
        });
      }
      return Promise.resolve(out);
    },

    postingFor(conversationId) {
      return indexFor(conversationId).posting;
    },

    putEntries(conversationId, entries) {
      if (entries.size === 0) {
        return Promise.resolve();
      }
      const index = indexFor(conversationId);
      const { tokensByRow } = internRows(index.table, entries);
      for (const [row, tokens] of tokensByRow) {
        // A rewrite must not leave its old tokens behind.
        for (const token of index.tokensByRow.get(row) ?? []) {
          if (!tokens.includes(token)) {
            removeFromToken(index, token, row);
          }
        }
        for (const token of tokens) {
          // A rewrite keeps the row's original creation time: it is a fact about
          // the message, not about the text currently indexed, and re-deriving it
          // from the incoming entry would let a stale device reorder history.
          const createdAt = index.table.createdAtByRow[row];
          if (createdAt !== undefined) {
            rowListAdd(listFor(index, token), row, createdAt);
          }
        }
        index.tokensByRow.set(row, tokens);
        // internRows only fills the preview for new rows; an edit rewrites the
        // text, so the preview follows every write, not just the first.
        const messageId = index.table.messageIdByRow[row];
        const preview = messageId ? entries.get(messageId)?.preview : undefined;
        if (preview !== undefined) {
          index.table.previewByRow[row] = preview;
        }
      }
      return Promise.resolve();
    },

    // The reference implementation of the query path: the posting lists are
    // intersected and the matched rows are projected out of the conversation
    // table, which is what a persistent backend does with a point read per
    // matched row.
    //
    // Postings stay keyed by token TEXT here. Interning them to dictionary ids
    // is a storage detail of the persistent backend, whose key is a stored
    // field; in memory there is nothing to look up by id.
    query(conversationId, tokens, limit, options) {
      const index = indexFor(conversationId);
      const empty: SearchIndexPostingList = {
        rows: new Uint32Array(0),
        times: new Float64Array(0),
      };
      const lists = tokens.map((token) => {
        const list = index.posting.get(token);
        return list ? rowListToArrays(list) : empty;
      });
      const prefix = options?.prefix;
      if (prefix !== undefined) {
        const expansions = expandPrefixTerm([...index.posting.keys()], prefix);
        if (expansions.length === 0) {
          return Promise.resolve({
            hasMore: false,
            rows: new Map(),
            totalMatched: 0,
          });
        }
        lists.push(
          unionPostingLists(
            expansions.map((term) => {
              const list = index.posting.get(term);
              return list ? rowListToArrays(list) : empty;
            })
          )
        );
      }
      const { matches, totalMatched } = intersectPostingLists(lists);
      const { hasMore, window } = selectNewestFirstWindow(
        matches,
        limit,
        options?.afterMatch
      );
      const { table } = index;
      // Only the WINDOW is resolved to facts, never the whole match set: row
      // resolution is the expensive half of a keystroke, and the cap is what
      // bounds it. The total above is exact regardless.
      const resolved: SearchIndexRowLookup = new Map();
      for (const match of window) {
        const messageId = table.messageIdByRow[match.row];
        if (messageId === undefined) {
          continue;
        }
        resolved.set(match.row, {
          createdAt: table.createdAtByRow[match.row] ?? match.createdAt,
          messageId,
          preview: table.previewByRow[match.row] ?? "",
          senderId: table.senderIdByRow[match.row] ?? "",
        });
      }
      return Promise.resolve({ hasMore, rows: resolved, totalMatched });
    },

    readAllPostingLists(conversationId) {
      const out = new Map<string, Uint32Array>();
      for (const [token, list] of indexFor(conversationId).posting) {
        out.set(token, rowListToArrays(list).rows);
      }
      return Promise.resolve(out);
    },

    readMeta(conversationId) {
      return Promise.resolve(metaByConversation.get(conversationId) ?? null);
    },

    readPending(conversationId) {
      // A copy, so a caller cannot mutate what the store will later hand back.
      return Promise.resolve([
        ...(pendingByConversation.get(conversationId) ?? []),
      ]);
    },

    // A test affordance, not part of the store contract: the query path goes
    // through `query` because a caller cannot resolve token ids without the table.
    readPostingList(conversationId: string, token: string) {
      const list = indexFor(conversationId).posting.get(token);
      // Materialized into a fresh array, so a caller cannot mutate the store's
      // list by accident.
      return Promise.resolve(
        list ? rowListToArrays(list).rows : new Uint32Array(0)
      );
    },

    readPostingTimes(conversationId: string, token: string) {
      const list = indexFor(conversationId).posting.get(token);
      return Promise.resolve(
        list ? rowListToArrays(list).times : new Float64Array(0)
      );
    },

    // Resolves only the requested rows. The in-memory backend happens to hold the
    // whole conversation, but resolving by id keeps it honest about the contract
    // the persistent backends implement, and keeps the query path's cost
    // independent of conversation size here too.
    readRows(conversationId, rowIds) {
      const { table } = indexFor(conversationId);
      const out: SearchIndexRowLookup = new Map();
      for (const row of rowIds) {
        const messageId = table.messageIdByRow[row];
        if (messageId === undefined) {
          continue;
        }
        out.set(row, {
          createdAt: table.createdAtByRow[row] ?? 0,
          messageId,
          preview: table.previewByRow[row] ?? "",
          senderId: table.senderIdByRow[row] ?? "",
        });
      }
      return Promise.resolve(out);
    },

    readStats(conversationId) {
      // Cumulative rows interned, from the row table's high-water mark. Matches
      // the persistent backends' allocator semantics, so the coverage label reads
      // the same whichever backend answered.
      return Promise.resolve({
        indexedRowCount: indexFor(conversationId).table.messageIdByRow.length,
      });
    },

    removeEntries(conversationId, messageIds) {
      const index = indexFor(conversationId);
      for (const messageId of messageIds) {
        const row = index.table.rowsByMessageId.get(messageId);
        if (row === undefined) {
          continue;
        }
        for (const token of index.tokensByRow.get(row) ?? []) {
          removeFromToken(index, token, row);
        }
        index.tokensByRow.delete(row);
      }
      return Promise.resolve();
    },

    tokenCount(conversationId) {
      return indexFor(conversationId).posting.size;
    },

    writeMeta(meta) {
      // Copied, including the array: a caller that keeps mutating the object it
      // passed must not reach into what the store hands back.
      metaByConversation.set(meta.conversationId, {
        ...meta,
        pendingIds: [...meta.pendingIds],
      });
      return Promise.resolve();
    },
    writePending(conversationId, messageIds) {
      if (messageIds.length === 0) {
        pendingByConversation.delete(conversationId);
        return Promise.resolve();
      }
      pendingByConversation.set(conversationId, [...messageIds]);
      return Promise.resolve();
    },
  };
}

export { emptySearchIndexMeta } from "./search-index-format";
