import { describe, expect, test } from "bun:test";

import { previewBatchForItems } from "./conversation-preview-requests";

function lastMessage(id: string, extra: Record<string, unknown> = {}) {
  return {
    ciphertext: `c-${id}`,
    deletedAt: null,
    id,
    iv: `iv-${id}`,
    ratchetIndex: 1,
    senderId: "u-peer",
    ...extra,
  };
}

describe("previewBatchForItems", () => {
  test("requests the last message of every conversation", () => {
    const batch = previewBatchForItems([
      { conversation: { id: "c1" }, lastMessage: lastMessage("m1") },
      { conversation: { id: "c2" }, lastMessage: lastMessage("m2") },
    ]);
    expect(batch.map((b) => b.conversationId)).toEqual(["c1", "c2"]);
    expect(batch[0].message).toEqual({
      ciphertext: "c-m1",
      id: "m1",
      iv: "iv-m1",
      ratchetIndex: 1,
      senderId: "u-peer",
    });
  });

  test("skips rows with no last message", () => {
    expect(
      previewBatchForItems([{ conversation: { id: "c1" }, lastMessage: null }])
    ).toEqual([]);
  });

  test("skips deleted last messages: the row previews from the row alone", () => {
    expect(
      previewBatchForItems([
        {
          conversation: { id: "c1" },
          lastMessage: lastMessage("m1", { deletedAt: "2026-01-01" }),
        },
      ])
    ).toEqual([]);
  });
});
