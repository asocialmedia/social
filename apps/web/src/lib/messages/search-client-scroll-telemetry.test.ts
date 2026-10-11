import { describe, expect, test } from "bun:test";

import type {
  MessageScrollFrameTelemetryRuntime,
  MessageScrollFrameTelemetryTarget,
} from "./search-client-telemetry";
import { startMessageScrollFrameTelemetry } from "./search-client-telemetry";

class FakeScrollTarget implements MessageScrollFrameTelemetryTarget {
  private listener: EventListener | null = null;

  addEventListener(
    _type: "scroll",
    listener: EventListener,
    _options?: AddEventListenerOptions
  ): void {
    this.listener = listener;
  }

  removeEventListener(_type: "scroll", listener: EventListener): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }

  dispatchScroll(): void {
    this.listener?.(new Event("scroll"));
  }

  get subscribed(): boolean {
    return this.listener !== null;
  }
}

function createFrameHarness() {
  let currentTime = 0;
  let nextFrameId = 0;
  const pendingFrames = new Map<number, FrameRequestCallback>();
  const recorded: { durationMs: number; event: string }[] = [];
  let hidden = false;
  const runtime: MessageScrollFrameTelemetryRuntime = {
    cancelFrame: (id) => pendingFrames.delete(id),
    isHidden: () => hidden,
    isSampled: () => true,
    now: () => currentTime,
    record: ({ durationMs, event }) => recorded.push({ durationMs, event }),
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- the test harness stores the browser animation-frame callback.
    requestFrame: (callback) => {
      nextFrameId += 1;
      pendingFrames.set(nextFrameId, callback);
      return nextFrameId;
    },
  };

  return {
    fireFrame(timestamp: number): void {
      currentTime = timestamp;
      const id = pendingFrames.keys().next().value;
      if (id === undefined) {
        return;
      }
      const callback = pendingFrames.get(id);
      if (!callback) {
        return;
      }
      pendingFrames.delete(id);
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- the harness invokes the stored animation-frame callback.
      callback(timestamp);
    },
    pendingFrameCount: () => pendingFrames.size,
    recorded,
    runtime,
    setHidden(value: boolean): void {
      hidden = value;
    },
    setTime(value: number): void {
      currentTime = value;
    },
  };
}

describe("startMessageScrollFrameTelemetry", () => {
  test("records bounded p95 frame intervals during sustained scrolling", () => {
    const target = new FakeScrollTarget();
    const harness = createFrameHarness();
    const stop = startMessageScrollFrameTelemetry(target, harness.runtime);

    for (let frame = 0; frame <= 180; frame += 1) {
      const timestamp = frame * (1000 / 60);
      harness.setTime(timestamp);
      target.dispatchScroll();
      harness.fireFrame(timestamp);
    }

    expect(harness.recorded).toHaveLength(1);
    expect(harness.recorded[0]?.event).toBe("scroll-frame");
    expect(harness.recorded[0]?.durationMs).toBeCloseTo(1000 / 60, 2);
    stop();
  });

  test("stops sampling after scroll idle and removes the listener on cleanup", () => {
    const target = new FakeScrollTarget();
    const harness = createFrameHarness();
    const stop = startMessageScrollFrameTelemetry(target, harness.runtime);

    target.dispatchScroll();
    for (let frame = 1; frame <= 51; frame += 1) {
      const timestamp = frame * 16;
      harness.setTime(timestamp);
      if (frame < 5) {
        target.dispatchScroll();
      }
      harness.fireFrame(timestamp);
    }

    expect(harness.pendingFrameCount()).toBe(0);
    expect(target.subscribed).toBe(true);
    target.dispatchScroll();
    expect(harness.pendingFrameCount()).toBe(1);
    stop();
    expect(harness.pendingFrameCount()).toBe(0);
    expect(target.subscribed).toBe(false);
  });

  test("drops background-sized frame gaps and does not subscribe unsampled users", () => {
    const target = new FakeScrollTarget();
    const harness = createFrameHarness();
    const unsampled = startMessageScrollFrameTelemetry(target, {
      ...harness.runtime,
      isSampled: () => false,
    });

    expect(target.subscribed).toBe(false);
    unsampled();

    const stop = startMessageScrollFrameTelemetry(target, harness.runtime);
    target.dispatchScroll();
    harness.fireFrame(16);
    harness.fireFrame(1000);

    expect(harness.recorded).toHaveLength(0);
    expect(harness.pendingFrameCount()).toBe(0);
    harness.setHidden(true);
    stop();
  });
});
