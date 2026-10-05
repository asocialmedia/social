import { describe, expect, test } from "bun:test";

import { openMessageWindow, readerMessageWindow } from "./reader-window";

const JOINED_AT = new Date("2026-03-01T12:00:00.000Z");
const LEFT_AT = new Date("2026-03-02T12:00:00.000Z");

describe("readerMessageWindow", () => {
  // The fix this module exists for. A newcomer holds no wrap for any epoch minted
  // before they arrived, so every pre-join row arrives as ciphertext this device
  // cannot decrypt - and the screen that used to show it anyway read as a broken
  // conversation rather than as history that was never theirs.
  test("a newcomer is floored at the moment they joined", () => {
    expect(
      readerMessageWindow({
        conversationType: "DEN",
        membership: { createdAt: JOINED_AT, leftAt: null },
      })
    ).toEqual({ after: JOINED_AT, before: null });
  });

  test("a current member of a den has no upper bound", () => {
    const window = readerMessageWindow({
      conversationType: "DEN",
      membership: { createdAt: JOINED_AT, leftAt: null },
    });
    expect(window.before).toBeNull();
  });

  // The bound that existed before this module, kept.
  test("a departed reader is capped at the moment they left", () => {
    expect(
      readerMessageWindow({
        conversationType: "DEN",
        membership: { createdAt: JOINED_AT, leftAt: LEFT_AT },
      })
    ).toEqual({ after: JOINED_AT, before: LEFT_AT });
  });

  // The rejoin case that would silently lose somebody's history. A rejoin CLEARS
  // `leftAt` on the existing membership row rather than inserting a new one, so
  // `createdAt` is still the first time this person was ever in this room - which is
  // exactly the date the floor wants.
  test("a rejoiner keeps the original join as their floor", () => {
    const rejoined = readerMessageWindow({
      conversationType: "DEN",
      membership: { createdAt: JOINED_AT, leftAt: null },
    });
    expect(rejoined.after).toEqual(JOINED_AT);
  });

  // A DM has exactly two participants and both were there at the start, so there is
  // no window in which either was absent. Flooring a DM at its membership row's
  // `createdAt` would blank every conversation whose first message predates the row.
  test("a DM is never floored", () => {
    expect(
      readerMessageWindow({
        conversationType: "DM",
        membership: { createdAt: JOINED_AT, leftAt: null },
      })
    ).toEqual({ after: null, before: null });
  });

  test("an absent membership row withholds nothing", () => {
    // The deliberate failure direction: this filter runs on a transcript the route's
    // own membership gate has already admitted the reader to, so an undecidable
    // filter shows the conversation rather than blanking it.
    for (const membership of [null, undefined]) {
      expect(
        readerMessageWindow({ conversationType: "DEN", membership })
      ).toEqual(openMessageWindow());
    }
  });

  test("a row with no timestamps at all withholds nothing", () => {
    expect(
      readerMessageWindow({
        conversationType: "DEN",
        membership: { createdAt: null, leftAt: null },
      })
    ).toEqual({ after: null, before: null });
  });

  // A row whose departure predates its own join can only come from a row that was
  // rewritten rather than updated. Answering "no window" keeps a self-contradictory
  // record from making a conversation permanently unreadable.
  test("a row that contradicts itself withholds nothing", () => {
    expect(
      readerMessageWindow({
        conversationType: "DEN",
        membership: {
          createdAt: LEFT_AT,
          leftAt: JOINED_AT,
        },
      })
    ).toEqual(openMessageWindow());
  });

  test("openMessageWindow is a fresh value each call", () => {
    // A conversation switch resets BY SETTING a window, and React bails out of a
    // render whose state is `Object.is`-equal, so a shared constant would make the
    // reset silently do nothing.
    expect(openMessageWindow()).not.toBe(openMessageWindow());
  });
});
