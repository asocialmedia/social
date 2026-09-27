import { describe, expect, test } from "bun:test";

import type { MessageData, MessagePage } from "@asm/db";

import { reconcileAnchoredWindow } from "./anchored-window";

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
