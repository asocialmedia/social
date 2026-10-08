import { describe, expect, test } from "bun:test";

import {
  MAX_MESSAGE_CHANGE_REPLAY_PAGES,
  MESSAGE_CHANGE_PAGE_SIZE,
  messageChangeCursorStorageKey,
  parseDurableMessageChangePage,
  readMessageChangeCursor,
  replayDurableMessageChanges,
  writeMessageChangeCursor,
} from "./durable-change-replay";

function change(sequence: number) {
  return {
    globallyDeleted: false,
    hiddenForViewer: false,
    id: `change-${sequence}`,
    kind: "message.edited",
    messageId: `message-${sequence}`,
    revision: 2,
    sequence,
    sourceAvailable: true,
    sourceRevision: 2,
  };
}

function page(input: {
  changes?: ReturnType<typeof change>[];
  cursor: string;
  resetRequired?: boolean;
}) {
  return {
    changes: input.changes ?? [],
    nextCursor: input.cursor,
    resetRequired: input.resetRequired ?? false,
  };
}

const { signal } = new AbortController();

describe("durable message change replay", () => {
  test("validates the response contract before exposing changes", () => {
    expect(
      parseDurableMessageChangePage({
        ...page({ changes: [change(1)], cursor: "cursor-1" }),
        snapshotSequence: 1,
      })?.changes
    ).toEqual([change(1)]);
    expect(
      parseDurableMessageChangePage(
        page({
          changes: [{ ...change(1), sequence: -1 }],
          cursor: "cursor-1",
        })
      )
    ).toBeNull();
    expect(parseDurableMessageChangePage({ changes: [], nextCursor: "" })).toBe(
      null
    );
  });

  test("replays keyset pages and stops after the first short page", async () => {
    const calls: (string | undefined)[] = [];
    const result = await replayDurableMessageChanges({
      cursor: "start",
      fetchPage: (cursor) => {
        calls.push(cursor);
        if (calls.length === 1) {
          return page({
            changes: Array.from({ length: MESSAGE_CHANGE_PAGE_SIZE }, (_, i) =>
              change(i + 1)
            ),
            cursor: "middle",
          });
        }
        return page({ changes: [change(101)], cursor: "done" });
      },
      signal,
    });

    expect(calls).toEqual(["start", "middle"]);
    expect(result.changes).toHaveLength(101);
    expect(result.cursor).toBe("done");
    expect(result.pages).toBe(2);
    expect(result.resetRequired).toBe(false);
  });

  test("returns a permission or retention reset without trusting stale pages", async () => {
    const result = await replayDurableMessageChanges({
      cursor: "old-scope",
      fetchPage: () => page({ cursor: "fresh-snapshot", resetRequired: true }),
      signal,
    });

    expect(result).toEqual({
      changes: [],
      cursor: "fresh-snapshot",
      pages: 1,
      resetRequired: true,
    });
  });

  test("restarts at a bounded snapshot after the replay page budget", async () => {
    const calls: (string | undefined)[] = [];
    const result = await replayDurableMessageChanges({
      cursor: "initial",
      fetchPage: (cursor) => {
        calls.push(cursor);
        if (cursor === undefined) {
          return page({ cursor: "snapshot", resetRequired: true });
        }
        return page({
          changes: Array.from({ length: MESSAGE_CHANGE_PAGE_SIZE }, (_, i) =>
            change((calls.length - 1) * MESSAGE_CHANGE_PAGE_SIZE + i + 1)
          ),
          cursor: `cursor-${calls.length}`,
        });
      },
      signal,
    });

    expect(calls).toHaveLength(MAX_MESSAGE_CHANGE_REPLAY_PAGES + 1);
    expect(calls.at(-1)).toBeUndefined();
    expect(result.resetRequired).toBe(true);
    expect(result.cursor).toBe("snapshot");
    expect(result.changes).toHaveLength(
      MAX_MESSAGE_CHANGE_REPLAY_PAGES * MESSAGE_CHANGE_PAGE_SIZE
    );
  });

  test("fails closed if a cursor repeats or the response is malformed", async () => {
    await expect(
      replayDurableMessageChanges({
        cursor: "same",
        fetchPage: () =>
          page({
            changes: Array.from({ length: MESSAGE_CHANGE_PAGE_SIZE }, (_, i) =>
              change(i + 1)
            ),
            cursor: "same",
          }),
        signal,
      })
    ).rejects.toThrow("cursor did not advance");

    await expect(
      replayDurableMessageChanges({
        fetchPage: () => ({ changes: [], nextCursor: 4 }),
        signal,
      })
    ).rejects.toThrow("Invalid conversation changes response");
  });

  test("persists opaque cursors under a user and conversation scoped key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(
      writeMessageChangeCursor(
        storage,
        "user/a",
        "conversation?b",
        "signed-token"
      )
    ).toBe(true);
    expect(messageChangeCursorStorageKey("user/a", "conversation?b")).toBe(
      "asm:message-changes:v1:user%2Fa:conversation%3Fb"
    );
    expect(readMessageChangeCursor(storage, "user/a", "conversation?b")).toBe(
      "signed-token"
    );
    expect(readMessageChangeCursor(storage, "other", "conversation?b")).toBe(
      undefined
    );
  });

  test("treats unavailable or oversized browser storage as a recoverable miss", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(readMessageChangeCursor(storage, "user", "conversation")).toBe(
      undefined
    );
    expect(
      writeMessageChangeCursor(storage, "user", "conversation", "cursor")
    ).toBe(false);
    expect(
      writeMessageChangeCursor(
        storage,
        "user",
        "conversation",
        "x".repeat(4097)
      )
    ).toBe(false);
  });
});
