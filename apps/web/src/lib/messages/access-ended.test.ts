import { describe, expect, test } from "bun:test";

import {
  ACCESS_ENDED_DESCRIPTION,
  ACCESS_ENDED_DISMISS_LABEL,
  ACCESS_ENDED_MESSAGE,
  accessEndedOnArrival,
  consumeSelfLeave,
  forgetSelfLeave,
  noteSelfLeave,
  SELF_LEAVE_DESCRIPTION,
} from "./access-ended";

// The wording a removed member is given.
//
// The removal dialog and the self-leave dialog read these words rather than
// carrying their own, so the copy is asserted here in one place: the composer and the
// thread are both too entangled with the session, the identity key and the message
// stream to render in a test at all.

describe("the wording", () => {
  test("the notice is the product's sentence, not the old explanation", () => {
    // The old line led with "You're no longer in this den" and then explained
    // the read-only half, which the notice no longer has room for. The toast
    // still says that part.
    expect(ACCESS_ENDED_MESSAGE).toBe(
      "Looks like you've lost your spot in this den"
    );
  });

  test("the dialog body keeps the fact the short title dropped", () => {
    // "You can still read this" is what tells somebody they do not have to do
    // anything, so it stays in the body where there is room for it. The composer's
    // placeholder cannot afford the sentence.
    expect(ACCESS_ENDED_DESCRIPTION).toBe(
      "You can still read this conversation, but you can't post in it."
    );
  });

  test("the acknowledgement is the product's, emoticon and all", () => {
    expect(ACCESS_ENDED_DISMISS_LABEL).toBe("Fair enough :(");
  });

  // One event, one headline. Two different ones meant a reader who saw the toast and
  // then looked down at the composer could not tell they were about the same thing.
  test("both dialogs title themselves with the same sentence", () => {
    expect(ACCESS_ENDED_MESSAGE).toBe(
      "Looks like you've lost your spot in this den"
    );
  });

  // They share a title and differ only in what they say survived, because the two
  // events differ in exactly that way.
  test("the two endings explain different things", () => {
    expect(SELF_LEAVE_DESCRIPTION).toContain("still in your messages");
    expect(ACCESS_ENDED_DESCRIPTION).toContain("still read this conversation");
  });
});

describe("accessEndedOnArrival", () => {
  // The state is a single boolean now. The dismissed flag went with the inline
  // notice it belonged to: a dialog is closed by the Dialog primitive, which already
  // owns that state, and keeping a second copy of "have they seen it" here is what
  // let a dismissal outlive the removal it was given for.
  test("arriving in a conversation is not being out of one", () => {
    expect(accessEndedOnArrival()).toEqual({ accessEnded: false });
  });

  test("there is no acknowledgement flag left to reset", () => {
    expect(Object.keys(accessEndedOnArrival())).toEqual(["accessEnded"]);
  });

  // The persistence decision, pinned: the removal does NOT survive the trip away and
  // back.
  //
  // `accessEnded` is re-established from scratch on every visit - the thread clears
  // it on a conversation switch and the server re-checks membership on every stream
  // connect, so the removal is genuinely news each time the reader arrives. What
  // explains it is the composer placeholder, which stands for as long as they are
  // out, so there is no window in which every control is greyed out with nothing on
  // screen saying why.
  test("the removal is cleared on arrival, so a rejoin can post again", () => {
    expect(accessEndedOnArrival().accessEnded).toBe(false);
  });

  // A conversation switch resets BY SETTING this value. A shared module-level
  // constant would be the same reference every time, and React bails out of a
  // render whose state is Object.is-equal to the old one — the reset would look
  // like it worked while doing nothing at all.
  test("every arrival is a fresh value, or the reset would be skipped", () => {
    expect(accessEndedOnArrival()).not.toBe(accessEndedOnArrival());
  });
});

describe("self-leave suppression", () => {
  test("leaving then consuming reports true exactly once", () => {
    noteSelfLeave("den-a");
    expect(consumeSelfLeave("den-a")).toBe(true);
    // Single-use: a second read is a removal, not the leave again.
    expect(consumeSelfLeave("den-a")).toBe(false);
  });

  test("a failed leave clears the marker", () => {
    // Otherwise the next genuine removal in this tab would be silent.
    noteSelfLeave("den-b");
    forgetSelfLeave("den-b");
    expect(consumeSelfLeave("den-b")).toBe(false);
  });

  test("one conversation's marker does not leak into another", () => {
    noteSelfLeave("den-c");
    expect(consumeSelfLeave("den-d")).toBe(false);
    expect(consumeSelfLeave("den-c")).toBe(true);
  });

  test("the leave dialog body explains what survives", () => {
    expect(SELF_LEAVE_DESCRIPTION).toContain("still in your messages");
    expect(SELF_LEAVE_DESCRIPTION).toContain("can't post");
  });
});
