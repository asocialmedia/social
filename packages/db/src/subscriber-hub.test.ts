import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { getSubscriberGauges, subscribeToChannel } from "./redis";

// A single in-memory fake connection shared by every `new IoRedis()` the hub
// creates, so the test can simulate inbound pub/sub deliveries.
let messageHandler: ((channel: string, message: string) => void) | null = null;

function deliver(channel: string, message: string): void {
  if (!messageHandler) {
    throw new Error("No message handler registered");
  }
  messageHandler(channel, message);
}

const fakeInstance = {
  on: mock((event: string, listener: () => void) => {
    if (event === "message") {
      messageHandler = listener as (channel: string, message: string) => void;
    }
    return fakeInstance;
  }),
  quit: mock(() => "OK"),
  status: "ready",
  subscribe: mock(() => Promise.resolve(1)),
  unsubscribe: mock(() => Promise.resolve(1)),
};

class FakeIoRedis {
  status = "ready";
  on = fakeInstance.on;
  subscribe = fakeInstance.subscribe;
  unsubscribe = fakeInstance.unsubscribe;
  quit = fakeInstance.quit;
}

mock.module("ioredis", () => ({
  default: FakeIoRedis,
}));

describe("shared pub/sub hub", () => {
  // The hub is a process-wide singleton, so track every subscription created
  // in this file and tear it all down after each test. That keeps gauge state
  // at zero between tests even when an assertion throws mid-test.
  const activeSubscriptions: (() => Promise<void>)[] = [];

  beforeEach(() => {
    fakeInstance.on.mockClear();
    fakeInstance.subscribe.mockClear();
    fakeInstance.unsubscribe.mockClear();
  });

  afterEach(async () => {
    await Promise.all(activeSubscriptions.splice(0).map((fn) => fn()));
  });

  async function subscribe(
    channel: string,
    listener: (channel: string, message: string) => void
  ) {
    const subscription = await subscribeToChannel(channel, listener);
    activeSubscriptions.push(subscription.unsubscribe);
    return subscription;
  }

  test("subscribes to a channel once for multiple listeners", async () => {
    await subscribe("ch:1", () => {});
    await subscribe("ch:1", () => {});
    expect(fakeInstance.subscribe).toHaveBeenCalledTimes(1);
    expect(fakeInstance.subscribe).toHaveBeenCalledWith("ch:1");
    expect(getSubscriberGauges().activeListeners).toBe(2);
    expect(getSubscriberGauges().activeChannels).toBe(1);
    expect(getSubscriberGauges().openStreams).toBe(2);
  });

  test("delivers every inbound message to each listener on the channel", async () => {
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    await subscribe("ch:1", (_c, m) => {
      receivedA.push(m);
    });
    await subscribe("ch:1", (_c, m) => {
      receivedB.push(m);
    });

    deliver("ch:1", "hello");
    deliver("other", "ignored");
    deliver("ch:1", "world");

    expect(receivedA).toEqual(["hello", "world"]);
    expect(receivedB).toEqual(["hello", "world"]);
  });

  test("ignores messages on channels nobody in this process listens to", async () => {
    let count = 0;
    await subscribe("ch:1", () => {
      count += 1;
    });
    deliver("ch:999", "nobody home");
    expect(count).toBe(0);
  });

  test("unsubscribes the redis channel only when the last listener leaves", async () => {
    const sub1 = await subscribe("ch:2", () => {});
    const sub2 = await subscribe("ch:2", () => {});
    await sub1.unsubscribe();
    // One listener remains, so the shared connection keeps the subscription.
    expect(fakeInstance.unsubscribe).not.toHaveBeenCalled();
    await sub2.unsubscribe();
    expect(fakeInstance.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fakeInstance.unsubscribe).toHaveBeenCalledWith("ch:2");
    expect(getSubscriberGauges().activeChannels).toBe(0);
    expect(getSubscriberGauges().openStreams).toBe(0);
  });

  test("unsubscribe is idempotent", async () => {
    const sub = await subscribe("ch:1", () => {});
    await sub.unsubscribe();
    await sub.unsubscribe();
    expect(fakeInstance.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
