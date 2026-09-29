import { describe, expect, test } from "bun:test";

import {
  activityFrameAction,
  activityRetryDelay,
  drainActivityFrames,
} from "./use-message-activity";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

describe("activityRetryDelay", () => {
  test("resets to the floor once a subscription is confirmed", () => {
    // A confirmed stream means Redis accepted the subscribe, so whatever drops
    // next is a new problem rather than the same one failing again.
    expect(activityRetryDelay(16_000, true)).toBe(INITIAL_RETRY_MS);
    expect(activityRetryDelay(INITIAL_RETRY_MS, true)).toBe(INITIAL_RETRY_MS);
  });

  test("keeps climbing while no subscription is confirmed", () => {
    // The server answers 200 before it subscribes, so an outage produces a
    // response with a body that closes and never sends `connected`. Resetting on
    // that response is what turns a Redis outage into a once-a-second reconnect
    // loop, so the ladder has to keep widening instead.
    expect(activityRetryDelay(INITIAL_RETRY_MS, false)).toBe(2000);
    expect(activityRetryDelay(2000, false)).toBe(4000);
    expect(activityRetryDelay(16_000, false)).toBe(30_000);
  });

  test("caps at the maximum rather than growing without bound", () => {
    expect(activityRetryDelay(MAX_RETRY_MS, false)).toBe(MAX_RETRY_MS);
  });

  test("an unconfirmed stream reaching the cap is not reset by the cap alone", () => {
    // Guards the specific failure: if the ladder were ever seeded from a
    // response rather than a confirmation, the unconfirmed path would look
    // identical to a confirmed one at the floor and stop escalating.
    let delay = INITIAL_RETRY_MS;
    const observed: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      observed.push(delay);
      delay = activityRetryDelay(delay, false);
    }
    expect(observed).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

// The exact frames the events route writes, so a change to either side shows up
// here rather than as a silently dead stream.
const CONNECTED_FRAME = "event: connected\ndata: {}";
const ACTIVITY_FRAME = 'event: message-activity\ndata: {"conversationId":"c1"}';
const KEEP_ALIVE_FRAME = ": keep-alive";

describe("activityFrameAction", () => {
  test("recognises the confirmation frame", () => {
    expect(activityFrameAction(CONNECTED_FRAME)).toBe("connected");
  });

  test("recognises the activity frame", () => {
    expect(activityFrameAction(ACTIVITY_FRAME)).toBe("activity");
  });

  test("ignores the keep-alive comment", () => {
    expect(activityFrameAction(KEEP_ALIVE_FRAME)).toBeNull();
  });

  test("does not confuse a frame whose data mentions another event", () => {
    // A conversation named after an SSE event must not be read as one.
    const frame = 'event: message-activity\ndata: {"title":"event: connected"}';
    expect(activityFrameAction(frame)).toBe("activity");
  });
});

describe("drainActivityFrames", () => {
  test("returns a complete frame and an empty tail", () => {
    expect(drainActivityFrames(`${CONNECTED_FRAME}\n\n`)).toEqual({
      frames: [CONNECTED_FRAME],
      rest: "",
    });
  });

  test("holds an incomplete frame until its terminator arrives", () => {
    // A chunk can end anywhere; a frame must not be acted on half-read.
    expect(drainActivityFrames("event: connected\ndata: {}")).toEqual({
      frames: [],
      rest: "event: connected\ndata: {}",
    });
  });

  test("splits several frames arriving in one chunk", () => {
    const buffer = `${CONNECTED_FRAME}\n\n${ACTIVITY_FRAME}\n\n${KEEP_ALIVE_FRAME}\n\n`;
    expect(drainActivityFrames(buffer).frames).toEqual([
      CONNECTED_FRAME,
      ACTIVITY_FRAME,
      KEEP_ALIVE_FRAME,
    ]);
  });

  test("keeps a partial trailing frame as the tail", () => {
    const buffer = `${CONNECTED_FRAME}\n\nevent: message-acti`;
    const { frames, rest } = drainActivityFrames(buffer);
    expect(frames).toEqual([CONNECTED_FRAME]);
    expect(rest).toBe("event: message-acti");
  });

  test("reassembles a frame split across the two terminating newlines", () => {
    const first = drainActivityFrames(`${CONNECTED_FRAME}\n`);
    expect(first.frames).toEqual([]);
    const second = drainActivityFrames(`${first.rest}\n`);
    expect(second.frames).toEqual([CONNECTED_FRAME]);
  });
});
