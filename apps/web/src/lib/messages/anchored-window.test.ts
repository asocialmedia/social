import { describe, expect, test } from "bun:test";

import type { MessageData, MessagePage } from "@/lib/messages/types";

import {
  buildAnchoredMessageWindow,
  messageWindowIncludesLatest,
  reconcileAnchoredWindow,
  shouldFoldLiveMessage,
} from "./anchored-window";

const CONVO = "c1";

function message(id: string, createdAt: number): MessageData {
  return {
    conversationId: CONVO,
    createdAt: new Date(createdAt),
    deletedAt: null,
    id,
    senderId: "peer",
  } as MessageData;
}

function page(rows: MessageData[], extra?: Partial<MessagePage>): MessagePage {
  return {
    messages: rows,
    previousCursor: "older-cursor",
    ...extra,
  };
}

describe("reconcileAnchoredWindow", () => {
  test("a slow jump response cannot overwrite an edit received during the request", () => {
    const newer = {
      ...message("target", 2000),
      ciphertext: "new",
      revision: 3,
    };
    const result = reconcileAnchoredWindow({
      currentPages: [page([newer])],
      fetched: page([{ ...newer, ciphertext: "old", revision: 2 }], {
        anchorIndex: 0,
        nextCursor: "newer",
      }),
      issuedIds: new Set(["target"]),
    });
    expect(result.messages[0]).toBe(newer);
    expect(result.anchorIndex).toBe(0);
    expect(result.nextCursor).toBe("newer");
  });

  test("a slow response cannot resurrect a message deleted during a search jump", () => {
    const deleted = {
      ...message("target", 2000),
      deletedAt: new Date(3000),
      revision: 3,
    };
    const result = reconcileAnchoredWindow({
      currentPages: [page([deleted])],
      fetched: page([{ ...deleted, deletedAt: null, revision: 2 }]),
      issuedIds: new Set(["target"]),
    });
    expect(result.messages[0]).toBe(deleted);
  });

  test("accepts a genuinely newer source revision in the jump response", () => {
    const older = {
      ...message("target", 2000),
      ciphertext: "old",
      revision: 2,
    };
    const newer = { ...older, ciphertext: "new", revision: 3 };
    const result = reconcileAnchoredWindow({
      currentPages: [page([older])],
      fetched: page([newer]),
      issuedIds: new Set(["target"]),
    });
    expect(result.messages[0]).toBe(newer);
  });
  // The race this exists for. A message the user was told arrived, folded into
  // the transcript while the jump's read was in flight, and then discarded by the
  // anchored read's blind write.
  test("keeps a message that arrived while the read was in flight", () => {
    const arrived = message("live", 9000);
    const result = reconcileAnchoredWindow({
      currentPages: [page([message("older", 1000), arrived])],
      fetched: page([message("older", 1000), message("target", 2000)]),
      issuedIds: new Set(["older", "target"]),
    });
    expect(result.messages.map((row) => row.id)).toEqual([
      "older",
      "target",
      "live",
    ]);
  });

  // The read asked for a window and got one; the transcript is the server's
  // answer, not a merge of two snapshots. Keeping the old copy of a row the
  // window covers would duplicate it.
  test("drops rows the fetched window already covers", () => {
    const result = reconcileAnchoredWindow({
      currentPages: [page([message("m1", 1000), message("m2", 2000)])],
      fetched: page([message("m1", 1000), message("m2", 2000)]),
      issuedIds: new Set(["m1", "m2"]),
    });
    expect(result.messages.map((row) => row.id)).toEqual(["m1", "m2"]);
  });

  // A prepended page is history, not a live arrival, and the anchored window is
  // chosen to be somewhere else. Carrying it would defeat the whole point of an
  // O(limit) read.
  test("does not carry history the window deliberately left out", () => {
    const result = reconcileAnchoredWindow({
      currentPages: [page([message("very-old", 1), message("target", 5000)])],
      fetched: page([message("target", 5000), message("newer", 6000)]),
      issuedIds: new Set(["very-old", "target", "newer"]),
    });
    expect(result.messages.map((row) => row.id)).toEqual(["target", "newer"]);
  });

  // Order is total, so a same-millisecond arrival cannot land on either side of
  // the boundary depending on input order.
  test("breaks a same-millisecond tie deterministically", () => {
    const result = reconcileAnchoredWindow({
      currentPages: [page([message("m-zzz", 5000)])],
      fetched: page([message("m-aaa", 5000)]),
      issuedIds: new Set(["m-aaa"]),
    });
    expect(result.messages.map((row) => row.id)).toEqual(["m-aaa", "m-zzz"]);
  });

  // A reconnect can land the same arrival twice, and this function reads from two
  // sources at once.
  test("carries an arrival once even when it appears on two pages", () => {
    const arrived = message("live", 9000);
    const result = reconcileAnchoredWindow({
      currentPages: [page([arrived]), page([arrived, message("older", 1)])],
      fetched: page([message("older", 1), message("target", 2)]),
      issuedIds: new Set(["older", "target"]),
    });
    expect(result.messages.filter((row) => row.id === "live")).toHaveLength(1);
  });

  test("an empty or absent transcript installs the window unchanged", () => {
    const fetched = page([message("target", 2)]);
    expect(reconcileAnchoredWindow({ fetched, issuedIds: new Set() })).toBe(
      fetched
    );
    expect(
      reconcileAnchoredWindow({
        currentPages: [],
        fetched,
        issuedIds: new Set(),
      })
    ).toBe(fetched);
  });

  // A window the server could not centre on -- the anchor was deleted, so the read
  // returned the nearest older window instead.
  test("an empty window installs unchanged rather than inventing rows", () => {
    const fetched = page([]);
    expect(
      reconcileAnchoredWindow({
        currentPages: [page([message("live", 9000)])],
        fetched,
        issuedIds: new Set(),
      })
    ).toBe(fetched);
  });

  test("preserves the cursors the anchored read returned", () => {
    const result = reconcileAnchoredWindow({
      currentPages: [page([message("live", 9000)])],
      fetched: page([message("target", 2)], {
        anchorIndex: 0,
        nextCursor: "newer-cursor",
        previousCursor: "older-cursor",
      }),
      issuedIds: new Set(["target"]),
    });
    expect(result.anchorIndex).toBe(0);
    expect(result.nextCursor).toBe("newer-cursor");
    expect(result.previousCursor).toBe("older-cursor");
  });
});

describe("installed search-jump window", () => {
  test("retains the target cursor and rejects live folding while reading older history", () => {
    const window = buildAnchoredMessageWindow({
      currentPages: [page([message("live-arrival", 9000)])],
      fetched: page([message("target", 2)], {
        anchorIndex: 0,
        nextCursor: "newer",
      }),
      issuedIds: new Set(),
      messageId: "target",
    });
    expect(window.pageParams).toEqual([
      { kind: "around", messageId: "target" },
    ]);
    expect(shouldFoldLiveMessage({ ...window, pinned: true })).toBe(false);
    expect(window.pages[0].anchorIndex).toBe(0);
    expect(window.pages[0].messages.map((row) => row.id)).toEqual(["target"]);
  });

  test("recognizes a search jump that has reached the actual latest messages", () => {
    const window = buildAnchoredMessageWindow({
      fetched: page([message("target", 2)], { nextCursor: null }),
      issuedIds: new Set(),
      messageId: "target",
    });
    expect(shouldFoldLiveMessage({ ...window, pinned: true })).toBe(true);
  });
});

describe("messageWindowIncludesLatest", () => {
  test("recognizes a fresh newest-page read", () => {
    expect(
      messageWindowIncludesLatest(
        [page([message("latest", 2)])],
        [{ kind: "older" }]
      )
    ).toBe(true);
  });

  test("recognizes an anchored page that has reached the conversation tail", () => {
    expect(
      messageWindowIncludesLatest(
        [page([message("latest", 2)], { nextCursor: null })],
        [{ kind: "around", messageId: "latest" }]
      )
    ).toBe(true);
  });

  test("detects when the newest page was evicted from a bounded window", () => {
    expect(
      messageWindowIncludesLatest(
        [page([message("older", 1)])],
        [{ cursor: "oldest", kind: "older" }]
      )
    ).toBe(false);
  });

  test("fails closed when cache pages and cursors are misaligned", () => {
    expect(
      messageWindowIncludesLatest([page([message("latest", 2)])], [])
    ).toBe(false);
  });
});

describe("shouldFoldLiveMessage", () => {
  const latest = page([message("latest", 3)], { nextCursor: null });
  const anchored = page([message("middle", 2)], { nextCursor: "newer" });

  test("folds an arrival only while the viewport follows the latest window", () => {
    expect(
      shouldFoldLiveMessage({
        pageParams: [{ kind: "older" }],
        pages: [latest],
        pinned: true,
      })
    ).toBe(true);
    expect(
      shouldFoldLiveMessage({
        pageParams: [{ kind: "older" }],
        pages: [latest],
        pinned: false,
      })
    ).toBe(false);
  });

  test("holds live arrivals out of a historical cursor window", () => {
    expect(
      shouldFoldLiveMessage({
        pageParams: [{ kind: "around", messageId: "middle" }],
        pages: [anchored],
        pinned: true,
      })
    ).toBe(false);
  });
});
