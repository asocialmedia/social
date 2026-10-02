import { describe, expect, test } from "bun:test";

import {
  ACCESS_ENDED_DESCRIPTION,
  ACCESS_ENDED_DISMISS_LABEL,
  ACCESS_ENDED_MESSAGE,
  accessEndedOnArrival,
  accessEndedToast,
  shouldShowAccessEndedNotice,
} from "./access-ended";

// The wording a removed member is given, and the one rule that decides whether
// they are still being told.
//
// Both surfaces (the composer's notice and the thread's toast) read these words
// rather than carrying their own, so the copy is asserted here in one place: the
// composer and the thread are both too entangled with the session, the identity
// key and the message stream to render in a test at all.

describe("the wording", () => {
  test("the notice is the product's sentence, not the old explanation", () => {
    // The old line led with "You're no longer in this den" and then explained
    // the read-only half, which the notice no longer has room for. The toast
    // still says that part.
    expect(ACCESS_ENDED_MESSAGE).toBe(
      "Looks like you've lost your spot in this den"
    );
  });

  test("the toast keeps the fact the short line dropped", () => {
    // "You can still read this" is what tells somebody they do not have to do
    // anything, so it stays on the toast where there is room for it.
    expect(ACCESS_ENDED_DESCRIPTION).toBe(
      "You can still read this conversation, but you can't post in it."
    );
  });

  test("the acknowledgement is the product's, emoticon and all", () => {
    expect(ACCESS_ENDED_DISMISS_LABEL).toBe("Fair enough :(");
  });

  test("the toast titles itself with the notice's sentence", () => {
    // One event, one sentence. Two different headlines meant a reader who saw
    // the toast and then looked down at the composer could not tell they were
    // about the same thing.
    expect(accessEndedToast()).toEqual({
      description: ACCESS_ENDED_DESCRIPTION,
      title: ACCESS_ENDED_MESSAGE,
    });
  });

  test("the toast offers no action, because it will be gone first", () => {
    // A button on something that disappears in four seconds offers something
    // the reader can no longer reach. The acknowledgement belongs on the notice,
    // which stays.
    expect(Object.keys(accessEndedToast())).not.toContain("action");
  });
});

describe("shouldShowAccessEndedNotice", () => {
  test("a member who is still inside the den sees nothing", () => {
    expect(
      shouldShowAccessEndedNotice({
        accessEnded: false,
        noticeDismissed: false,
      })
    ).toBe(false);
  });

  test("a member the server has removed is told", () => {
    expect(
      shouldShowAccessEndedNotice({ accessEnded: true, noticeDismissed: false })
    ).toBe(true);
  });

  // The press. Nothing else about the composer changes, which is the point: the
  // button acknowledges, it does not act.
  test("the acknowledgement puts the notice away", () => {
    expect(
      shouldShowAccessEndedNotice({ accessEnded: true, noticeDismissed: true })
    ).toBe(false);
  });

  // The asymmetry, stated as the gate it is: only the server can raise the
  // notice and only the reader can lower it. So no sequence of presses can put
  // anybody back into a den, and nothing about dismissing leaks into the write
  // paths, which read `accessEnded` and not this.
  test("a dismissal is silence, never access", () => {
    expect(
      shouldShowAccessEndedNotice({ accessEnded: false, noticeDismissed: true })
    ).toBe(false);
  });

  test("the flag is read rather than consumed, so a second press is the same as one", () => {
    const dismissed = { accessEnded: true, noticeDismissed: true };
    expect(shouldShowAccessEndedNotice(dismissed)).toBe(false);
    expect(shouldShowAccessEndedNotice({ ...dismissed })).toBe(false);
  });
});

describe("accessEndedOnArrival", () => {
  test("arriving in a conversation is not being out of one", () => {
    expect(accessEndedOnArrival()).toEqual({
      accessEnded: false,
      noticeDismissed: false,
    });
  });

  // The persistence decision, pinned: a dismissal does NOT survive the trip away
  // and back.
  //
  // `accessEnded` is re-established from scratch on every visit — the thread
  // clears it on a conversation switch and the server re-checks membership on
  // every stream connect, so the removal is genuinely news each time the reader
  // arrives. A dismissal that outlived the switch would leave the worst possible
  // state: every composer control greyed out with nothing on screen explaining
  // why, for a reader who has forgotten a conversation they left days ago. The
  // notice is the standing explanation of the gates, so it has to keep standing;
  // it stays dismissible, so acknowledging it stays free.
  test("arriving back clears the acknowledgement, so the notice is asked again", () => {
    const arrived = accessEndedOnArrival();
    expect(arrived.noticeDismissed).toBe(false);
    expect(shouldShowAccessEndedNotice({ ...arrived, accessEnded: true })).toBe(
      true
    );
  });

  test("the removal is cleared on arrival too, so a rejoin can post again", () => {
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
