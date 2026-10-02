import { describe, expect, test } from "bun:test";

import {
  DEN_UNKNOWN_SENDER_NAME,
  shouldShowSenderName,
} from "./message-sender-name";

describe("shouldShowSenderName", () => {
  test("a den shows the name on the first row of a run", () => {
    expect(
      shouldShowSenderName({
        conversationType: "DEN",
        isFirstInGroup: true,
        mine: false,
      })
    ).toBe(true);
  });

  test("a den does not repeat it down the run", () => {
    // Grouping already made the run read as one block through its spacing and its
    // interlocked corners; a name on every bubble would undo that at a glance.
    expect(
      shouldShowSenderName({
        conversationType: "DEN",
        isFirstInGroup: false,
        mine: false,
      })
    ).toBe(false);
  });

  test("a DM never shows a name", () => {
    // One other person is in the room and the header above the transcript already
    // names them, so the byline is twenty repetitions of what is known.
    for (const isFirstInGroup of [true, false]) {
      expect(
        shouldShowSenderName({
          conversationType: "DM",
          isFirstInGroup,
          mine: false,
        })
      ).toBe(false);
    }
  });

  test("the reader's own messages never show one either", () => {
    for (const conversationType of ["DM", "DEN"] as const) {
      expect(
        shouldShowSenderName({
          conversationType,
          isFirstInGroup: true,
          mine: true,
        })
      ).toBe(false);
    }
  });
});

describe("DEN_UNKNOWN_SENDER_NAME", () => {
  test("an unresolved sender reads as a person, not as nothing", () => {
    // A membership row whose user was deleted underneath it still decrypts, and a
    // blank byline in a room full of people reads as the reader's own message --
    // the one answer that is wrong.
    expect(DEN_UNKNOWN_SENDER_NAME.length).toBeGreaterThan(0);
    expect(DEN_UNKNOWN_SENDER_NAME.trim()).toBe(DEN_UNKNOWN_SENDER_NAME);
  });
});
