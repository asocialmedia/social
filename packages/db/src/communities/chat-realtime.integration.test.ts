import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import {
  getSubscriberGauges,
  getSubscriberGeneration,
  redis,
  subscribeToChannel,
} from "@asm/db";

async function subscriberIds(): Promise<string[]> {
  const clients = String(await redis.call("CLIENT", "LIST"));
  return clients
    .trim()
    .split("\n")
    .flatMap((line) => {
      const fields = Object.fromEntries(
        line.split(" ").map((field) => field.split("="))
      );
      return fields.flags?.includes("P") && fields.id ? [fields.id] : [];
    });
}

async function waitUntil(predicate: () => boolean, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Redis subscriber did not recover before the deadline");
    }
    // oxlint-disable-next-line no-await-in-loop -- Poll this test process's subscriber until reconnect completion.
    await Bun.sleep(25);
  }
}

test("the shared subscriber reconnects and releases only its own room listeners", async () => {
  const before = new Set(await subscriberIds());
  const gauges = getSubscriberGauges();
  const channel = `community-chat-reconnect-test:${randomUUID()}`;
  const received: string[] = [];
  const first = await subscribeToChannel(channel, (_, message) =>
    received.push(`one:${message}`)
  );
  const second = await subscribeToChannel(channel, (_, message) =>
    received.push(`two:${message}`)
  );
  try {
    expect(getSubscriberGauges().activeChannels).toBe(
      gauges.activeChannels + 1
    );
    expect(getSubscriberGauges().activeListeners).toBe(
      gauges.activeListeners + 2
    );
    await redis.publish(channel, "before");
    await waitUntil(() => received.length === 2);
    const currentIds = await subscriberIds();
    const newIds = currentIds.filter((id) => !before.has(id));
    expect(newIds).toHaveLength(1);
    const generation = getSubscriberGeneration();
    // Disconnect only the new subscriber owned by this isolated test process.
    // The Redis service and the application's subscriber connections stay up.
    await redis.call("CLIENT", "KILL", "ID", newIds[0] ?? "0");
    await waitUntil(() => getSubscriberGeneration() > generation);
    await redis.publish(channel, "after");
    await waitUntil(() => received.length === 4);
    expect(received).toEqual([
      "one:before",
      "two:before",
      "one:after",
      "two:after",
    ]);
    await first.unsubscribe();
    await first.unsubscribe();
    await redis.publish(channel, "last");
    await waitUntil(() => received.length === 5);
    expect(received.at(-1)).toBe("two:last");
  } finally {
    await first.unsubscribe();
    await second.unsubscribe();
  }
  expect(getSubscriberGauges()).toEqual(gauges);
}, 20_000);
