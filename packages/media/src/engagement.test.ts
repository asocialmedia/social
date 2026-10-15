import { describe, expect, test } from "bun:test";

import { EngagementSession } from "./engagement";
import type { EngagementEvent, EngagementSample } from "./engagement";

function session() {
  const events: EngagementEvent[] = [];
  return {
    events,
    tracker: new EngagementSession((event) => events.push(event)),
  };
}
const playing: EngagementSample = {
  duration: 10,
  foreground: true,
  playing: true,
  position: 0,
  video: true,
  visible: true,
};

describe("shared web and native engagement", () => {
  test("background and hidden time cannot create impressions or dwell", () => {
    const { events, tracker } = session();
    for (let time = 0; time <= 5000; time += 250) {
      tracker.sample(
        { ...playing, foreground: false, position: time / 1000 },
        time
      );
    }
    tracker.stop();
    expect(events).toEqual([]);
  });
  test("a stalled video records buffering without completion, dwell, or a skip", () => {
    const { events, tracker } = session();
    for (let time = 0; time <= 10_000; time += 250) {
      tracker.sample({ ...playing, buffering: true }, time);
    }
    tracker.stop();
    expect(events.map((event) => event.eventType)).toEqual([
      "IMPRESSION",
      "BUFFER",
    ]);
    expect(events.at(-1)?.durationMs).toBe(10_000);
  });
  test("mutating the caller's sample still measures advancing playback", () => {
    const { events, tracker } = session();
    const sample = { ...playing };
    for (let time = 0; time <= 9250; time += 250) {
      sample.position = time / 1000;
      tracker.sample(sample, time);
    }
    tracker.stop();
    expect(
      events.filter((event) => event.eventType === "VIEW_COMPLETE")
    ).toHaveLength(1);
    expect(
      events.find((event) => event.eventType === "DWELL")?.durationMs
    ).toBe(9250);
    expect(
      events.filter((event) => event.eventType === "PLAYBACK_STARTUP")
    ).toHaveLength(1);
  });
  test("seeking over most of the clip cannot earn completion", () => {
    const { events, tracker } = session();
    tracker.sample(playing, 0);
    tracker.sample({ ...playing, position: 9.9 }, 250);
    tracker.stop();
    expect(events.some((event) => event.eventType === "VIEW_COMPLETE")).toBe(
      false
    );
  });

  test("2x playback can complete a clip while dwell still measures foreground time", () => {
    const { events, tracker } = session();
    for (let time = 0; time <= 4500; time += 250) {
      tracker.sample({ ...playing, position: time / 500 }, time);
    }
    tracker.stop();
    expect(
      events.filter((event) => event.eventType === "VIEW_COMPLETE")
    ).toHaveLength(1);
    expect(
      events.find((event) => event.eventType === "DWELL")?.durationMs
    ).toBe(4500);
  });
  test("playback errors are never negative preference signals", () => {
    const { events, tracker } = session();
    for (let time = 0; time <= 1000; time += 250) {
      tracker.sample({ ...playing, position: time / 1000 }, time);
    }
    tracker.sample({ ...playing, failed: true, position: 1 }, 1250);
    tracker.stop();
    tracker.stop();
    expect(
      events.filter((event) => event.eventType === "PLAYBACK_ERROR")
    ).toHaveLength(1);
    expect(events.some((event) => event.eventType === "SKIP")).toBe(false);
  });
  test("leaving quickly emits a single skip even if cleanup repeats", () => {
    const { events, tracker } = session();
    for (let time = 0; time <= 1000; time += 250) {
      tracker.sample({ ...playing, position: time / 1000 }, time);
    }
    tracker.stop();
    tracker.stop();
    expect(events.filter((event) => event.eventType === "SKIP")).toHaveLength(
      1
    );
  });
});
