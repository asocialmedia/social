import { expect, test } from "bun:test";

import type { ConversationListResponse } from "../lib/client";
import type { MessageData } from "../lib/types";
import { ConversationListStore } from "./conversation-list-store";
import { messageCacheScope } from "./message-cache";
import { TranscriptStore } from "./transcript-store";

function message(id: string, seconds: number): MessageData {
  return {
    ciphertext: `encrypted-${id}`,
    conversationId: "chat",
    createdAt: new Date(seconds * 1000).toISOString(),
    deletedAt: null,
    editedAt: null,
    id,
    iv: "iv",
    ratchetIndex: seconds,
    senderId: "peer",
  };
}

function list(id = "chat"): ConversationListResponse {
  const conversation = {
    createdAt: "2026-01-01",
    id,
    keys: [],
    members: [],
    pairKey: null,
    updatedAt: "2026-01-01",
  };
  return {
    conversations: [conversation],
    hasMore: true,
    items: [
      {
        conversation,
        isNew: false,
        lastMessage: message("last", 3),
        unreadCount: 2,
      },
    ],
    nextCursor: id,
  };
}

test("background conversation refresh retains plaintext in memory and never exports it", () => {
  const store = new ConversationListStore();
  store.replaceAll(list(), "me", 123);
  store.applyPreview(
    new Map([["last", { content: "PRIVATE PLAINTEXT", type: "text" }]])
  );
  const payload = store.getSnapshot().rows[0]?.payload;
  store.replaceAll(list(), "me", 456);
  expect(store.getSnapshot().rows[0]?.payload).toBe(payload);
  expect(store.getSnapshot().rows[0]?.preview).toContain("PRIVATE PLAINTEXT");
  expect(JSON.stringify(store.exportCiphertextResponse())).not.toContain(
    "PRIVATE PLAINTEXT"
  );
  expect(store.getUpdatedAt()).toBe(456);
  const deleted = list();
  if (deleted.items[0]?.lastMessage) {
    deleted.items[0].lastMessage.deletedAt = "2026-01-02";
  }
  store.replaceAll(deleted, "me");
  expect(store.getSnapshot().rows[0]?.payload).toBeUndefined();
  store.replaceAll(list(), "another-account");
  expect(store.getSnapshot().rows[0]?.payload).toBeUndefined();
});

test("first-page conversation polling retains already loaded older pages and cursor", () => {
  const store = new ConversationListStore();
  store.replaceAll(list("first"), "me");
  store.appendOlder(list("older"), "me");
  store.replaceAll(list("first"), "me", 456, true);
  expect(store.getSnapshot().rows.map((row) => row.conversation.id)).toEqual([
    "first",
    "older",
  ]);
  expect(store.getSnapshot().nextCursor).toBe("older");
});

test("newest-message refresh preserves loaded history, row identity, order and terminal older cursor", () => {
  const store = new TranscriptStore();
  const newest = message("new", 3);
  store.setPages("chat", { messages: [newest], previousCursor: "new" });
  store.prependOlder("chat", {
    messages: [message("old", 1), message("middle", 2)],
    previousCursor: null,
  });
  store.setPages(
    "chat",
    { messages: [{ ...newest }, message("arrival", 4)], previousCursor: "new" },
    456
  );
  expect(store.getSnapshot("chat").messages.map((row) => row.id)).toEqual([
    "old",
    "middle",
    "new",
    "arrival",
  ]);
  expect(store.getSnapshot("chat").messages[2]).toBe(newest);
  expect(store.getSnapshot("chat").hasMoreOlder).toBe(false);
  expect(store.getUpdatedAt("chat")).toBe(456);
  store.setPages("chat", {
    messages: [{ ...newest, ciphertext: "edited", editedAt: "2026-01-02" }],
    previousCursor: "new",
  });
  expect(store.getSnapshot("chat").messages[2]?.ciphertext).toBe("edited");
  expect(store.exportCiphertextPages().chat?.page.messages).toHaveLength(4);
  store.clearAll();
  expect(store.exportCiphertextPages()).toEqual({});
});

test("unchanged background transcript checks do not notify or re-render readers", () => {
  const store = new TranscriptStore();
  const first = message("first", 1);
  store.setPages("chat", { messages: [first], previousCursor: null });
  let renders = 0;
  store.subscribe(() => {
    renders += 1;
  });
  store.setSnapshotLoading("chat", true);
  store.setPages(
    "chat",
    { messages: [{ ...first }], previousCursor: null },
    789
  );
  expect(renders).toBe(0);
  expect(store.getUpdatedAt("chat")).toBe(789);
});

test("disk cache follows the recovered identity so a self-reset never resurrects old local history", () => {
  const original = messageCacheScope(
    "https://api.example",
    "alice",
    "old-public-key"
  );
  expect(
    messageCacheScope("https://api.example", "alice", "old-public-key")
  ).toBe(original);
  expect(
    messageCacheScope("https://api.example", "alice", "new-public-key")
  ).not.toBe(original);
  expect(
    messageCacheScope("https://api.example", "bob", "old-public-key")
  ).not.toBe(original);
  expect(
    messageCacheScope("https://other.example", "alice", "old-public-key")
  ).not.toBe(original);
});
