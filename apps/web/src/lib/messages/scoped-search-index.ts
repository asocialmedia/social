import type {
  SearchIndexStore,
  SearchIndexConversationSummary,
} from "./search-index-format";

export interface SearchIndexScope {
  recoveryGeneration: number;
  userId: string;
}

function scopePrefix(scope: SearchIndexScope): string {
  return `${JSON.stringify([scope.userId, scope.recoveryGeneration])}\u0000`;
}

export function createScopedSearchIndexStore(
  store: SearchIndexStore,
  scope: SearchIndexScope
): SearchIndexStore {
  const prefix = scopePrefix(scope);
  const scopedConversationId = (conversationId: string) =>
    `${prefix}${conversationId}`;

  return {
    async clearConversation(conversationId) {
      await store.clearConversation(scopedConversationId(conversationId));
    },
    async countPending(conversationId) {
      return await store.countPending(scopedConversationId(conversationId));
    },
    async hasIndexedMessages(conversationId, messageIds) {
      return await store.hasIndexedMessages(
        scopedConversationId(conversationId),
        messageIds
      );
    },
    async hasPendingMessages(conversationId, messageIds) {
      return await store.hasPendingMessages(
        scopedConversationId(conversationId),
        messageIds
      );
    },
    async listConversations(): Promise<SearchIndexConversationSummary[]> {
      const summaries = await store.listConversations();
      return summaries.flatMap((summary) => {
        if (!summary.conversationId.startsWith(prefix)) {
          return [];
        }
        return [
          {
            ...summary,
            conversationId: summary.conversationId.slice(prefix.length),
          },
        ];
      });
    },
    async putEntries(conversationId, entries) {
      await store.putEntries(scopedConversationId(conversationId), entries);
    },
    async putSharedRefs(conversationId, rows) {
      await store.putSharedRefs(scopedConversationId(conversationId), rows);
    },
    async query(conversationId, tokens, limit, options) {
      return await store.query(
        scopedConversationId(conversationId),
        tokens,
        limit,
        options
      );
    },
    async readAllPostingLists(conversationId) {
      return await store.readAllPostingLists(
        scopedConversationId(conversationId)
      );
    },
    async readMeta(conversationId) {
      const meta = await store.readMeta(scopedConversationId(conversationId));
      return meta ? { ...meta, conversationId } : null;
    },
    async readPendingPage(conversationId, options) {
      return await store.readPendingPage(
        scopedConversationId(conversationId),
        options
      );
    },
    async readRows(conversationId, rowIds) {
      return await store.readRows(scopedConversationId(conversationId), rowIds);
    },
    async readSharedRefs(conversationId, kind, options) {
      return await store.readSharedRefs(
        scopedConversationId(conversationId),
        kind,
        options
      );
    },
    async readSharedRefsCounts(conversationId) {
      return await store.readSharedRefsCounts(
        scopedConversationId(conversationId)
      );
    },
    async readStats(conversationId) {
      return await store.readStats(scopedConversationId(conversationId));
    },
    async removeEntries(conversationId, messageIds) {
      await store.removeEntries(
        scopedConversationId(conversationId),
        messageIds
      );
    },
    async removeSharedRefs(conversationId, messageIds) {
      await store.removeSharedRefs(
        scopedConversationId(conversationId),
        messageIds
      );
    },
    async updatePending(conversationId, changes) {
      return await store.updatePending(
        scopedConversationId(conversationId),
        changes
      );
    },
    async writeMeta(meta) {
      await store.writeMeta({
        ...meta,
        conversationId: scopedConversationId(meta.conversationId),
      });
    },
  };
}

export async function clearSearchIndexScope(
  store: SearchIndexStore,
  scope: SearchIndexScope
): Promise<boolean> {
  try {
    const scopedStore = createScopedSearchIndexStore(store, scope);
    const conversations = await scopedStore.listConversations();
    let succeeded = true;
    // oxlint-disable no-await-in-loop -- avoid opening unbounded IDB write transactions
    for (const conversation of conversations) {
      try {
        await scopedStore.clearConversation(conversation.conversationId);
      } catch {
        succeeded = false;
      }
    }
    // oxlint-enable no-await-in-loop
    return succeeded;
  } catch {
    return false;
  }
}

export async function clearAllSearchIndexScopes(
  store: SearchIndexStore
): Promise<boolean> {
  try {
    const conversations = await store.listConversations();
    let succeeded = true;
    // oxlint-disable no-await-in-loop -- avoid opening unbounded IDB write transactions
    for (const conversation of conversations) {
      try {
        await store.clearConversation(conversation.conversationId);
      } catch {
        succeeded = false;
      }
    }
    // oxlint-enable no-await-in-loop
    return succeeded;
  } catch {
    return false;
  }
}
