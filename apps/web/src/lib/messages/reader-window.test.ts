import { describe, expect, test } from "bun:test";

import {
  openMessageWindow,
  readerMessageWindow,
  readerMessageWindows,
  readerWindowsContain,
} from "./reader-window";
import type { ReaderMembershipEvent } from "./reader-window";

const JOINED_AT = new Date("2026-03-01T12:00:00.000Z");
const LEFT_AT = new Date("2026-03-02T12:00:00.000Z");
const REJOINED_AT = new Date("2026-03-04T12:00:00.000Z");
const GAP_MESSAGE_AT = new Date("2026-03-03T12:00:00.000Z");
const LEFT_AGAIN_AT = new Date("2026-03-05T12:00:00.000Z");

const USER_ID = "user-1";

function event(
  action: string,
  createdAt: Date,
  overrides: Partial<ReaderMembershipEvent> = {}
): ReaderMembershipEvent {
  return {
    action,
    actorId: USER_ID,
    createdAt,
    targetUserId: null,
    ...overrides,
  };
}

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

  // The row alone cannot express "left and came back": a rejoin CLEARS `leftAt`
  // on the existing row rather than inserting a new one, so the singular form
  // still answers the original join as the floor. Hiding the gap between the two
  // stints is the plural form's job, and needs the membership log.
  test("a rejoiner's row still floors at the original join", () => {
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

describe("readerMessageWindows", () => {
  // The whole point of the plural form: somebody who left and came back is
  // entitled to both stints and to nothing between them. The row alone cannot
  // say this - its `createdAt` is the first join and its `leftAt` is cleared -
  // so the boundaries come from the membership log.
  test("a rejoiner holds both stints and the gap stays hidden", () => {
    const windows = readerMessageWindows({
      conversationType: "DEN",
      events: [
        event("JOINED", JOINED_AT),
        event("LEFT", LEFT_AT),
        event("JOINED", REJOINED_AT),
      ],
      membership: { createdAt: JOINED_AT, leftAt: null },
      userId: USER_ID,
    });
    expect(windows).toEqual([
      { after: JOINED_AT, before: LEFT_AT },
      { after: REJOINED_AT, before: null },
    ]);
    expect(readerWindowsContain(windows, JOINED_AT)).toBe(true);
    expect(readerWindowsContain(windows, GAP_MESSAGE_AT)).toBe(false);
    expect(readerWindowsContain(windows, REJOINED_AT)).toBe(true);
  });

  test("a member who never left holds exactly the row window", () => {
    expect(
      readerMessageWindows({
        conversationType: "DEN",
        events: [event("CREATED", JOINED_AT)],
        membership: { createdAt: JOINED_AT, leftAt: null },
        userId: USER_ID,
      })
    ).toEqual([{ after: JOINED_AT, before: null }]);
  });

  test("a departed member's single stint is capped at the departure", () => {
    expect(
      readerMessageWindows({
        conversationType: "DEN",
        events: [event("JOINED", JOINED_AT), event("LEFT", LEFT_AT)],
        membership: { createdAt: JOINED_AT, leftAt: LEFT_AT },
        userId: USER_ID,
      })
    ).toEqual([{ after: JOINED_AT, before: LEFT_AT }]);
  });

  test("two gaps stay hidden across three stints", () => {
    const windows = readerMessageWindows({
      conversationType: "DEN",
      events: [
        event("JOINED", JOINED_AT),
        event("LEFT", LEFT_AT),
        event("JOINED", REJOINED_AT),
        event("REMOVED", LEFT_AGAIN_AT, {
          actorId: "owner-1",
          targetUserId: USER_ID,
        }),
      ],
      membership: { createdAt: JOINED_AT, leftAt: LEFT_AGAIN_AT },
      userId: USER_ID,
    });
    expect(windows).toEqual([
      { after: JOINED_AT, before: LEFT_AT },
      { after: REJOINED_AT, before: LEFT_AGAIN_AT },
    ]);
    expect(readerWindowsContain(windows, GAP_MESSAGE_AT)).toBe(false);
  });

  // A membership older than the log has no lines at all, and the only honest
  // answer left is the row window - which is also the answer every reader got
  // before stints existed.
  test("no log lines falls back to the row window", () => {
    expect(
      readerMessageWindows({
        conversationType: "DEN",
        events: [],
        membership: { createdAt: JOINED_AT, leftAt: null },
        userId: USER_ID,
      })
    ).toEqual([{ after: JOINED_AT, before: null }]);
  });

  // The log starts mid-membership for rooms whose log was introduced later: the
  // first line for this reader is their departure. The stint opened when the row
  // says it did, not at the epoch.
  test("a close with no opener opens at the row's createdAt", () => {
    expect(
      readerMessageWindows({
        conversationType: "DEN",
        events: [event("LEFT", LEFT_AT)],
        membership: { createdAt: JOINED_AT, leftAt: LEFT_AT },
        userId: USER_ID,
      })
    ).toEqual([{ after: JOINED_AT, before: LEFT_AT }]);
  });

  test("other members' lines and role changes are ignored", () => {
    expect(
      readerMessageWindows({
        conversationType: "DEN",
        events: [
          event("JOINED", new Date("2026-02-01T12:00:00.000Z"), {
            actorId: "user-2",
          }),
          event("REMOVED", new Date("2026-02-02T12:00:00.000Z"), {
            actorId: "owner-1",
            targetUserId: "user-2",
          }),
          event("PROMOTED", new Date("2026-02-03T12:00:00.000Z"), {
            actorId: "owner-1",
            targetUserId: USER_ID,
          }),
          event("CREATED", JOINED_AT),
        ],
        membership: { createdAt: JOINED_AT, leftAt: null },
        userId: USER_ID,
      })
    ).toEqual([{ after: JOINED_AT, before: null }]);
  });

  test("bounds are inclusive on both ends", () => {
    const windows = readerMessageWindows({
      conversationType: "DEN",
      events: [event("JOINED", JOINED_AT), event("LEFT", LEFT_AT)],
      membership: { createdAt: JOINED_AT, leftAt: LEFT_AT },
      userId: USER_ID,
    });
    expect(readerWindowsContain(windows, JOINED_AT)).toBe(true);
    expect(readerWindowsContain(windows, LEFT_AT)).toBe(true);
  });

  test("a DM answers the single unfloored window even with log lines", () => {
    expect(
      readerMessageWindows({
        conversationType: "DM",
        events: [event("JOINED", JOINED_AT)],
        membership: { createdAt: JOINED_AT, leftAt: null },
        userId: USER_ID,
      })
    ).toEqual([{ after: null, before: null }]);
  });

  test("an absent membership row withholds nothing", () => {
    expect(
      readerMessageWindows({
        conversationType: "DEN",
        events: [],
        membership: null,
        userId: USER_ID,
      })
    ).toEqual([openMessageWindow()]);
  });

  test("a row that contradicts itself withholds nothing", () => {
    expect(
      readerMessageWindows({
        conversationType: "DEN",
        events: [event("JOINED", JOINED_AT)],
        membership: { createdAt: LEFT_AT, leftAt: JOINED_AT },
        userId: USER_ID,
      })
    ).toEqual([openMessageWindow()]);
  });
});
