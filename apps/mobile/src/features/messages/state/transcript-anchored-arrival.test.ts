import { expect, test } from "bun:test";

import type { MessageData } from "../lib/types";
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

test("an arrival past an anchored window flags newer content", () => {
  const store = new TranscriptStore();
  store.replaceWindow("chat", {
    messages: [message("a", 1), message("b", 2)],
    nextCursor: "b",
    previousCursor: null,
  });
  expect(store.getSnapshot("chat").hasMoreNewer).toBe(true);
  store.markNewerAvailable("chat");
  expect(store.getSnapshot("chat").hasMoreNewer).toBe(true);
});

test("a tail window that reaches the live end can be told there is more", () => {
  const store = new TranscriptStore();
  store.setPages("chat", {
    messages: [message("a", 1)],
    nextCursor: null,
    previousCursor: null,
  });
  expect(store.getSnapshot("chat").hasMoreNewer).toBe(false);
  store.markNewerAvailable("chat");
  expect(store.getSnapshot("chat").hasMoreNewer).toBe(true);
});

test("an unknown conversation is left alone", () => {
  const store = new TranscriptStore();
  store.markNewerAvailable("missing");
  expect(store.getSnapshot("missing").hasMoreNewer).toBe(false);
});
