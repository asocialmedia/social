import { describe, expect, test } from "bun:test";

import { collectSearchCorpus } from "./search-corpus";
import type { MessageData } from "./types";

const message: MessageData = {
  ciphertext: "ciphertext",
  conversationId: "chat",
  createdAt: "2026-10-09T00:00:00Z",
  deletedAt: null,
  editedAt: null,
  id: "message",
  iv: "iv",
  ratchetIndex: 0,
  senderId: "alice",
};

describe("session search corpus", () => {
  test("a different account or conversation never inherits plaintext", () => {
    const first = collectSearchCorpus(
      { rows: new Map(), scope: null },
      "alice:chat",
      [message],
      new Map([[message.id, { content: "private words", type: "text" }]])
    );
    expect(first.rows.size).toBe(1);
    expect(
      collectSearchCorpus(first, "bob:chat", [message], new Map()).rows.size
    ).toBe(0);
    expect(
      collectSearchCorpus(first, "alice:other", [message], new Map()).rows.size
    ).toBe(0);
    expect(
      collectSearchCorpus(first, null, [message], new Map()).rows.size
    ).toBe(0);
  });

  test("payload cache eviction preserves results and deleting a message removes them", () => {
    const first = collectSearchCorpus(
      { rows: new Map(), scope: null },
      "alice:chat",
      [message],
      new Map([[message.id, { content: "find me", type: "text" }]])
    );
    expect(collectSearchCorpus(first, "alice:chat", [message], new Map())).toBe(
      first
    );
    expect(
      collectSearchCorpus(first, "alice:chat", [], new Map()).rows.size
    ).toBe(0);
    expect(
      collectSearchCorpus(
        first,
        "alice:chat",
        [{ ...message, deletedAt: message.createdAt }],
        new Map()
      ).rows.size
    ).toBe(0);
  });
});
