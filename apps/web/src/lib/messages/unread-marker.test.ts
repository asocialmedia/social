// Where the "new messages" rule goes, which is the same rule the unread badge is
// counted with -- the oldest unseen message from the peer.

import { describe, expect, test } from "bun:test";

import { firstUnreadMessageId } from "./unread-marker";

const T = (minutes: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, minutes)).toISOString();

function message(
  id: string,
  minutes: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    createdAt: T(minutes),
    id,
    senderId: "peer",
    ...overrides,
  };
}

describe("firstUnreadMessageId", () => {
  test("finds the oldest peer message past the watermark", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: T(2),
        messages: [message("a", 1), message("b", 3), message("c", 4)],
        myUserId: "me",
      })
    ).toBe("b");
  });

  test("a message AT the watermark is read", () => {
    // The watermark is set FROM a message, so that message is the last one seen.
    // A `>=` here would put the divider above a message the reader just read.
    expect(
      firstUnreadMessageId({
        lastReadAt: T(3),
        messages: [message("a", 3), message("b", 4)],
        myUserId: "me",
      })
    ).toBe("b");
  });

  test("nothing past the watermark is nothing unread", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: T(9),
        messages: [message("a", 1), message("b", 3)],
        myUserId: "me",
      })
    ).toBeNull();
  });

  // Matching the server's count, which skips own messages: the sender has read
  // what they wrote, so a run of them must not become the boundary.
  test("own messages are never the boundary", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: T(1),
        messages: [
          message("mine", 2, { senderId: "me" }),
          message("theirs", 3),
        ],
        myUserId: "me",
      })
    ).toBe("theirs");
  });

  test("a deleted row is skipped, as the count skips it", () => {
    // A divider above a message that only says it was deleted is a divider above
    // nothing.
    expect(
      firstUnreadMessageId({
        lastReadAt: T(1),
        messages: [
          message("gone", 2, { deletedAt: T(2) }),
          message("there", 3),
        ],
        myUserId: "me",
      })
    ).toBe("there");
  });

  // A null watermark means never read, so the conversation opens on the message
  // that started it rather than scrolled to the bottom.
  test("a never-read conversation anchors on the first peer message", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: null,
        messages: [
          message("mine", 1, { senderId: "me" }),
          message("theirs", 2),
        ],
        myUserId: "me",
      })
    ).toBe("theirs");
  });

  test("a never-read conversation with no peer messages has no boundary", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: null,
        messages: [message("mine", 1, { senderId: "me" })],
        myUserId: "me",
      })
    ).toBeNull();
  });

  test("an unparseable watermark cannot suppress a real boundary", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: "not a date",
        messages: [message("a", 1)],
        myUserId: "me",
      })
    ).toBe("a");
  });

  test("an unparseable message timestamp is skipped rather than trusted", () => {
    expect(
      firstUnreadMessageId({
        lastReadAt: T(1),
        messages: [
          message("bad", 2, { createdAt: "nope" }),
          message("good", 3),
        ],
        myUserId: "me",
      })
    ).toBe("good");
  });

  test("an empty transcript has no boundary", () => {
    expect(
      firstUnreadMessageId({ lastReadAt: T(1), messages: [], myUserId: "me" })
    ).toBeNull();
  });
});
