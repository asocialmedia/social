import { describe, expect, test } from "bun:test";

import { createMemorySearchIndexStore } from "./memory-search-index";
import {
  clearAllSearchIndexScopes,
  clearSearchIndexScopesExcept,
  createScopedSearchIndexStore,
} from "./scoped-search-index";
import { buildSearchIndexEntry } from "./search-index-format";

const entry = buildSearchIndexEntry({
  createdAt: 1_700_000_000_000,
  senderId: "sender",
  text: "private preview text",
});

if (!entry) {
  throw new Error("Expected the scoped-index fixture to be searchable");
}

describe("account-scoped legacy search indexes", () => {
  test("isolates the same conversation and message ids by account and recovery generation", async () => {
    const baseStore = createMemorySearchIndexStore();
    const firstAccount = createScopedSearchIndexStore(baseStore, {
      recoveryGeneration: 1,
      userId: "account-a",
    });
    const secondAccount = createScopedSearchIndexStore(baseStore, {
      recoveryGeneration: 1,
      userId: "account-b",
    });
    const resetAccount = createScopedSearchIndexStore(baseStore, {
      recoveryGeneration: 2,
      userId: "account-a",
    });

    await firstAccount.putEntries(
      "conversation",
      new Map([["message", entry]])
    );
    await firstAccount.putSharedRefs(
      "conversation",
      new Map([
        [
          "message",
          {
            createdAt: 1_700_000_000_000,
            messageId: "message",
            refs: {
              links: ["https://example.test/path"],
              media: [],
              postIds: [],
            },
            senderId: "sender",
          },
        ],
      ])
    );
    await firstAccount.updatePending("conversation", { add: ["pending"] });

    const firstResults = await firstAccount.query(
      "conversation",
      ["private"],
      20
    );
    const secondResults = await secondAccount.query(
      "conversation",
      ["private"],
      20
    );
    const resetResults = await resetAccount.query(
      "conversation",
      ["private"],
      20
    );
    expect(firstResults.totalMatched).toBe(1);
    expect(secondResults.totalMatched).toBe(0);
    expect(resetResults.totalMatched).toBe(0);
    expect(await secondAccount.countPending("conversation")).toBe(0);
    expect(await firstAccount.countPending("conversation")).toBe(1);
    const firstRefs = await firstAccount.readSharedRefs(
      "conversation",
      "link",
      {
        limit: 10,
      }
    );
    const secondRefs = await secondAccount.readSharedRefs(
      "conversation",
      "link",
      { limit: 10 }
    );
    const firstConversations = await firstAccount.listConversations();
    expect(firstRefs.items).toHaveLength(1);
    expect(secondRefs.items).toEqual([]);
    expect(firstConversations.map((item) => item.conversationId)).toEqual([
      "conversation",
    ]);
    expect(await secondAccount.listConversations()).toEqual([]);
  });

  test("purges other account and recovery scopes without clearing the active scope", async () => {
    const baseStore = createMemorySearchIndexStore();
    const firstAccount = createScopedSearchIndexStore(baseStore, {
      recoveryGeneration: 1,
      userId: "account-a",
    });
    const secondAccount = createScopedSearchIndexStore(baseStore, {
      recoveryGeneration: 1,
      userId: "account-b",
    });

    await firstAccount.putEntries("conversation-a", new Map([["a", entry]]));
    await secondAccount.putEntries("conversation-b", new Map([["b", entry]]));

    expect(
      await clearSearchIndexScopesExcept(baseStore, {
        recoveryGeneration: 1,
        userId: "account-a",
      })
    ).toBe(true);
    const firstResults = await firstAccount.query(
      "conversation-a",
      ["private"],
      20
    );
    const secondResults = await secondAccount.query(
      "conversation-b",
      ["private"],
      20
    );
    const remainingConversations = await baseStore.listConversations();
    expect(firstResults.totalMatched).toBe(1);
    expect(secondResults.totalMatched).toBe(0);
    expect(remainingConversations).toHaveLength(1);
  });

  test("retires every legacy scope after server search cutover", async () => {
    const baseStore = createMemorySearchIndexStore();
    const firstAccount = createScopedSearchIndexStore(baseStore, {
      recoveryGeneration: 1,
      userId: "account-a",
    });
    const secondAccount = createScopedSearchIndexStore(baseStore, {
      recoveryGeneration: 1,
      userId: "account-b",
    });

    await firstAccount.putEntries("conversation-a", new Map([["a", entry]]));
    await secondAccount.putEntries("conversation-b", new Map([["b", entry]]));

    expect(await clearAllSearchIndexScopes(baseStore)).toBe(true);
    expect(await baseStore.listConversations()).toEqual([]);
  });
});
