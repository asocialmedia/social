// In-memory backend for the search index.
//
// This is the test backend and the reference implementation of the store
// contract: every rule lives in search-index-format.ts (pure, tested) and in the
// contract itself, so the browser backend cannot drift from this one. Bun has no
// IndexedDB, and the browser-only IDB code is untested for the same reason, which
// is why the logic that matters is kept out of the storage layer.

import {
  emptySearchIndexRowList,
  emptySearchIndexRowTable,
  internRows,
  rowListAdd,
  rowListRemove,
  rowListToArray,
} from "./search-index-format";
import type {
  SearchIndexConversationSummary,
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
  // Test affordance: the live posting map, for structural assertions.
  postingFor: (conversationId: string) => Map<string, SearchIndexRowList>;
  tokenCount: (conversationId: string) => number;
} {
  const byConversation = new Map<string, ConversationIndex>();
  // Per store instance: two stores in one process must not share meta, or a test
  // would see another store's conversation state.
  const metaByConversation = new Map<string, SearchIndexMeta>();

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
      return Promise.resolve();
    },

    conversations() {
      return [...byConversation.keys()];
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
          rowListAdd(listFor(index, token), row);
        }
        index.tokensByRow.set(row, tokens);
      }
      return Promise.resolve();
    },

    readAllPostingLists(conversationId) {
      const out = new Map<string, Uint32Array>();
      for (const [token, list] of indexFor(conversationId).posting) {
        out.set(token, rowListToArray(list));
      }
      return Promise.resolve(out);
    },

    readMeta(conversationId) {
      return Promise.resolve(metaByConversation.get(conversationId) ?? null);
    },

    readPostingList(conversationId, token) {
      const list = indexFor(conversationId).posting.get(token);
      // Materialized into a fresh array, so a caller cannot mutate the store's
      // list by accident.
      return Promise.resolve(list ? rowListToArray(list) : new Uint32Array(0));
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
  };
}

export { emptySearchIndexMeta } from "./search-index-format";
