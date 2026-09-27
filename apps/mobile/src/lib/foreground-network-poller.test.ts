import { describe, expect, test } from "bun:test";

import { ForegroundNetworkPoller } from "./foreground-network-poller";
import type { PollerNetworkState } from "./foreground-network-poller";

type Listener<T> = (value: T) => void;

function testPoller(
  intervalMs: number,
  onPoll: () => Promise<void> | void,
  skipInitialPoll?: boolean
) {
  let appState = "background";
  let network: PollerNetworkState = { isConnected: false };
  let appListener: Listener<string> | null = null;
  let networkListener: Listener<PollerNetworkState> | null = null;
  const intervals = new Map<number, () => void>();
  let nextTimer = 1;
  const poller = new ForegroundNetworkPoller({
    appState: {
      getCurrentState: () => appState,
      subscribe: (listener) => {
        appListener = listener;
        return { remove: () => (appListener = null) };
      },
    },
    clearInterval: (timer) => {
      intervals.delete(Number(timer));
    },
    intervalMs,
    network: {
      getState: () => Promise.resolve(network),
      subscribe: (listener) => {
        networkListener = listener;
        return { remove: () => (networkListener = null) };
      },
    },
    onPoll,
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    setInterval: (callback: () => void) => {
      const timer = nextTimer;
      nextTimer += 1;
      intervals.set(timer, callback);
      return timer as unknown as ReturnType<typeof setInterval>;
    },
    skipInitialPoll,
  });
  return {
    intervals,
    poller,
    setAppState(value: string) {
      appState = value;
      appListener?.(value);
    },
    setNetwork(value: PollerNetworkState) {
      network = value;
      networkListener?.(value);
    },
  };
}

describe("ForegroundNetworkPoller", () => {
  test("waits for foreground and network before its first poll", async () => {
    let polls = 0;
    const harness = testPoller(1000, () => {
      polls += 1;
    });
    harness.poller.start();
    await Promise.resolve();
    harness.setNetwork({ isConnected: true, isInternetReachable: true });
    expect(polls).toBe(0);
    harness.setAppState("active");
    expect(polls).toBe(1);
    expect(harness.intervals.size).toBe(1);
  });

  test("suspends offline/background and resumes with one poll", async () => {
    let polls = 0;
    const harness = testPoller(1000, () => {
      polls += 1;
    });
    harness.poller.start();
    await Promise.resolve();
    harness.setAppState("active");
    harness.setNetwork({ isConnected: true, isInternetReachable: true });
    expect(polls).toBe(1);
    harness.setAppState("background");
    expect(harness.intervals.size).toBe(0);
    await Promise.resolve();
    harness.setAppState("active");
    expect(polls).toBe(2);
    await Promise.resolve();
    harness.setNetwork({ isConnected: false });
    expect(harness.intervals.size).toBe(0);
    await Promise.resolve();
    harness.setNetwork({ isConnected: true, isInternetReachable: true });
    expect(polls).toBe(3);
    harness.poller.stop();
    expect(harness.intervals.size).toBe(0);
  });

  test("does not overlap a slow poll", async () => {
    let polls = 0;
    let release: (() => void) | undefined;
    const harness = testPoller(1000, async () => {
      polls += 1;
      // oxlint-disable-next-line promise/avoid-new
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    harness.poller.start();
    await Promise.resolve();
    harness.setAppState("active");
    harness.setNetwork({ isConnected: true, isInternetReachable: true });
    const [callback] = [...harness.intervals.values()];
    // oxlint-disable-next-line node/callback-return, promise/prefer-await-to-callbacks
    callback?.();
    expect(polls).toBe(1);
    release?.();
    // oxlint-disable-next-line promise/avoid-new, eslint/no-promise-executor-return
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    // oxlint-disable-next-line node/callback-return, promise/prefer-await-to-callbacks
    callback?.();
    expect(polls).toBe(2);
  });

  test("skips initial poll when skipInitialPoll is true", async () => {
    let polls = 0;
    const harness = testPoller(
      1000,
      () => {
        polls += 1;
      },
      true
    );
    harness.poller.start();
    await Promise.resolve();
    harness.setAppState("active");
    harness.setNetwork({ isConnected: true, isInternetReachable: true });
    expect(polls).toBe(0);
    expect(harness.intervals.size).toBe(1);
    const [callback] = [...harness.intervals.values()];
    // oxlint-disable-next-line node/callback-return, promise/prefer-await-to-callbacks
    callback?.();
    expect(polls).toBe(1);
  });
});
