import { describe, expect, test } from "bun:test";

import { GustViewSession } from "./gust-view-session";
import type { RecommendationEvent } from "./gusts-api";
import {
  FLUSH_DELAY_MS,
  MAX_QUEUE,
  RecommendationQueue,
  VIEW_COMPLETE_MS,
} from "./recommendation-tracker";
import type { TrackerClock } from "./recommendation-tracker";

// A manual clock: timers fire only when advance() passes their deadline.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: TrackerClock = {
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as number);
    },
    now: () => now,
    setTimeout: (run, ms) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, run });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.run();
      }
    }
  };
  return { advance, clock };
}

function recorder() {
  const batches: RecommendationEvent[][] = [];
  return {
    batches,
    send: (events: RecommendationEvent[]) => {
      batches.push(events);
      return Promise.resolve();
    },
  };
}

describe("RecommendationQueue", () => {
  test("flushes once after the delay", () => {
    const { advance, clock } = fakeClock();
    const { batches, send } = recorder();
    const queue = new RecommendationQueue(send, clock);
    queue.push("IMPRESSION", "p1", "VIEW_START", "p1");
    advance(FLUSH_DELAY_MS - 1);
    expect(batches).toHaveLength(0);
    advance(1);
    expect(batches).toEqual([
      [
        { eventType: "IMPRESSION", postId: "p1" },
        { eventType: "VIEW_START", postId: "p1" },
      ],
    ]);
  });

  test("flushes immediately at the cap", () => {
    const { clock } = fakeClock();
    const { batches, send } = recorder();
    const queue = new RecommendationQueue(send, clock);
    for (let index = 0; index < MAX_QUEUE; index += 1) {
      queue.push("IMPRESSION", `p${index}`);
    }
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(MAX_QUEUE);
    expect(queue.size).toBe(0);
  });

  test("drops a failed batch instead of growing forever", async () => {
    const { clock } = fakeClock();
    const queue = new RecommendationQueue(
      () => Promise.reject(new Error("offline")),
      clock
    );
    queue.push("DWELL", "p1", 1200);
    await queue.flush();
    expect(queue.size).toBe(0);
  });
});

describe("GustViewSession", () => {
  test("impression once, completion after 8s, dwell on leave", async () => {
    const { advance, clock } = fakeClock();
    const { batches, send } = recorder();
    const queue = new RecommendationQueue(send, clock);
    const session = new GustViewSession("g1", queue, clock);

    session.start();
    advance(VIEW_COMPLETE_MS);
    session.stop();
    session.start();
    advance(500);
    session.stop();
    await queue.flush();

    const events = batches.flat().map((event) => event.eventType);
    expect(events).toEqual([
      "IMPRESSION",
      "VIEW_START",
      "VIEW_COMPLETE",
      "DWELL",
      "DWELL",
    ]);
    const dwells = batches
      .flat()
      .filter((event) => event.eventType === "DWELL")
      .map((event) => event.durationMs);
    expect(dwells).toEqual([VIEW_COMPLETE_MS, 500]);
  });

  test("leaving early never logs a completion", async () => {
    const { advance, clock } = fakeClock();
    const { batches, send } = recorder();
    const queue = new RecommendationQueue(send, clock);
    const session = new GustViewSession("g1", queue, clock);
    session.start();
    advance(3000);
    session.stop();
    advance(VIEW_COMPLETE_MS);
    await queue.flush();
    expect(
      batches.flat().some((event) => event.eventType === "VIEW_COMPLETE")
    ).toBe(false);
  });
});
