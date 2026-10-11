import { describe, expect, test } from "bun:test";

import {
  jumpTargetSource,
  jumpReadErrorCopy,
  needsTailReturn,
  jumpTextErrorCopy,
  transcriptLoadingCopy,
} from "./message-thread";

// The reported bug: pressing Next during indexing put up a "Loading older
// messages" prompt that blinked on and off, repeatedly, without loading anything.
//
// The prompt used to hang off `isFetchingPreviousPage`, which is false in the gap
// BETWEEN a walk's sequential page requests -- so one jump of several pages
// switched the prompt off and on once per page. It now hangs off the operation
// that owns the loader, and says what is being waited for.
describe("transcriptLoadingCopy", () => {
  const IDLE = {
    isFetchingPreviousPage: false,
    jumpActivity: null,
    jumpTextPending: false,
  } as const;

  // One string for every history read. An anchored read and a drain are the same
  // thing to the reader, and a third transient label is noise, not clarity.
  test("an anchored read reads as loading messages, like any other read", () => {
    expect(transcriptLoadingCopy({ ...IDLE, jumpActivity: "anchor" })).toBe(
      "Loading older messages"
    );
  });

  test("a drain is loading older messages, for its whole run", () => {
    // The case the blinking came from: the drain holds the loader across several
    // sequential requests, and every one of them used to toggle the prompt.
    expect(transcriptLoadingCopy({ ...IDLE, jumpActivity: "drain" })).toBe(
      "Loading older messages"
    );
  });

  test("an ordinary history fill still says what it always said", () => {
    expect(
      transcriptLoadingCopy({ ...IDLE, isFetchingPreviousPage: true })
    ).toBe("Loading older messages");
  });

  // A target already in the transcript needs no read at all -- only its text.
  // Reporting that as "could not load" is what made a visible message look
  // unreachable.
  test("a wait on a message's own text is named as such", () => {
    expect(
      transcriptLoadingCopy({
        isFetchingPreviousPage: false,
        jumpActivity: null,
        jumpTextPending: true,
      })
    ).toBe("Loading message text");
    // And it outranks whatever else is going on, because it is the thing the
    // user is actually waiting for.
    expect(
      transcriptLoadingCopy({
        isFetchingPreviousPage: true,
        jumpActivity: "drain",
        jumpTextPending: true,
      })
    ).toBe("Loading message text");
  });
});

// A boolean could not express this: "the row is not loaded" and "the row is
// loaded but still encrypted" both answered false, and the caller reported the
// first as a decrypt failure the decryptor never made.
describe("jumpTextErrorCopy", () => {
  test("a settled wait says nothing, because nothing went wrong", () => {
    expect(jumpTextErrorCopy("settled")).toBe("");
    expect(jumpTextErrorCopy("settled", "error")).toBe("");
  });

  test("an unsettled wait on a row the decryptor gave up on names the decrypt", () => {
    expect(jumpTextErrorCopy("unsettled", "error")).toBe(
      "That message's text could not be decrypted."
    );
  });

  // The one that was wrong before: the decryptor never said "error", so claiming
  // it could not be decrypted invents a failure the user cannot act on.
  test("an unsettled wait that is not a failure says it is still loading", () => {
    expect(jumpTextErrorCopy("unsettled", "pending")).toBe(
      "That message's text is still loading."
    );
    // Evicted from the decryptor's cache, so nothing is known about it at all.
    expect(jumpTextErrorCopy("unsettled")).toBe(
      "That message's text is still loading."
    );
  });
});

// The reported bug: a jump onto a message that is not in the loaded window
// fetched an anchored window, then asked the LOADED CACHE whether it had the
// target -- and of course it did not, because the cache had not been given the
// window yet. The result was ignored, so the jump scrolled onto a bubble whose
// text had not decrypted and reported success.
describe("jumpTargetSource", () => {
  const targetId = "m-target";

  test("a target in the fetched window is served by that window", () => {
    expect(
      jumpTargetSource({
        fetchedMessageIds: ["m-other", targetId],
        loadedMessageIds: ["m-other"],
        targetId,
      })
    ).toBe("fetched");
  });

  // The exact shape of the bug: the target is ONLY in the window that has not
  // been installed yet. Answering "absent" here is what made the read useless.
  test("a target only in the not-yet-installed window is still found", () => {
    expect(
      jumpTargetSource({
        fetchedMessageIds: [targetId],
        loadedMessageIds: [],
        targetId,
      })
    ).toBe("fetched");
  });

  test("a target already loaded is served without a fetch", () => {
    expect(
      jumpTargetSource({
        fetchedMessageIds: null,
        loadedMessageIds: ["m-a", targetId],
        targetId,
      })
    ).toBe("loaded");
  });

  test("a target in neither is absent, which is what sends the drain walking", () => {
    expect(
      jumpTargetSource({
        fetchedMessageIds: ["m-other"],
        loadedMessageIds: ["m-a"],
        targetId,
      })
    ).toBe("absent");
  });

  test("an empty fetched window does not shadow a loaded target", () => {
    expect(
      jumpTargetSource({
        fetchedMessageIds: [],
        loadedMessageIds: [targetId],
        targetId,
      })
    ).toBe("loaded");
  });
});

// A jump that could not land its target has to say which of two very different
// things happened. "The endpoint throttled us" and "this message is not in the
// conversation" are both a missing bubble on screen, and reporting the first as
// the second is what made a rate-limited read look like a deleted row.
describe("jumpReadErrorCopy", () => {
  test("a landed jump says nothing", () => {
    expect(jumpReadErrorCopy("landed")).toBe("");
  });

  test("a throttled read is never reported as a missing message", () => {
    expect(jumpReadErrorCopy("throttled")).toBe(
      "Too many requests. Try again in a moment."
    );
  });

  test("an expired session is named as such", () => {
    expect(jumpReadErrorCopy("unauthorized")).toContain("session");
  });

  test("a dropped read is a network problem, not a missing row", () => {
    expect(jumpReadErrorCopy("read-failed")).toContain("connection");
  });

  // The only outcome that may claim the message is gone, and it reads as the
  // plain miss it is.
  test("an exhausted walk reports a plain miss", () => {
    expect(jumpReadErrorCopy("unreachable")).toBe(
      "Couldn't load that message."
    );
  });

  test("no read-failure copy claims the message does not exist", () => {
    for (const outcome of [
      "throttled",
      "unauthorized",
      "read-failed",
    ] as const) {
      expect(jumpReadErrorCopy(outcome)).not.toBe(
        "Couldn't load that message."
      );
    }
  });
});

// "Scroll to latest" after a search jump. The jump replaces the whole transcript
// with one anchored page from the middle of history, so the virtualizer's end is
// the end of THAT page -- up to a hundred messages short of the present. The
// report was "it pushes me to the bottom of that page itself", which is exactly
// that, and it is only correct if something fetches the newest messages first.
describe("needsTailReturn", () => {
  // The ordinary case: the transcript already sits on the newest page, so the
  // scroll costs nothing and no read is issued.
  test("a transcript at the newest message just scrolls", () => {
    expect(
      needsTailReturn({
        hasLatestPage: true,
        hasNextPage: false,
        inFlight: false,
      })
    ).toBe(false);
  });

  // The bug. A jump left a cursor for newer messages, so the window is not the
  // tail and the end of the list is not the bottom of the conversation.
  test("a transcript anchored mid-history fetches the tail first", () => {
    expect(
      needsTailReturn({
        hasLatestPage: false,
        hasNextPage: true,
        inFlight: false,
      })
    ).toBe(true);
  });

  // A double-click on the button is ordinary. Two concurrent tail reads would
  // race their cache writes, and whichever landed second would decide where "the
  // bottom" is -- so a "go to latest" that ends up not at the latest.
  test("a second press while the tail read is in flight does not start another", () => {
    expect(
      needsTailReturn({
        hasLatestPage: false,
        hasNextPage: true,
        inFlight: true,
      })
    ).toBe(false);
  });

  // A failed read must not wedge the button: the ref is released in a finally, so
  // the next press can try again.
  test("an idle guard with an anchored window still fetches", () => {
    expect(
      needsTailReturn({
        hasLatestPage: false,
        hasNextPage: true,
        inFlight: false,
      })
    ).toBe(true);
  });

  test("refetches the tail after the bounded window evicted its newest page", () => {
    expect(
      needsTailReturn({
        hasLatestPage: false,
        hasNextPage: false,
        inFlight: false,
      })
    ).toBe(true);
  });
});
