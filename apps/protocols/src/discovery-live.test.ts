import { expect, test } from "bun:test";

import { createDiscoveryLive } from "./discovery-live";
import { MemoryDiscoveryStore } from "./discovery-store";

const watch = { locale: "en", mode: "latest", topics: [] };

test("safe and opt-in viewers refresh separate pools and renew only their own policy", async () => {
  let now = 1_000_000;
  const policies: boolean[] = [];
  const live = createDiscoveryLive({
    now: () => now,
    publish: () => Promise.resolve(),
    read: (scope) => {
      policies.push(scope.explicit);
      return Promise.resolve({ cursor: null, items: [], partial: false });
    },
    store: new MemoryDiscoveryStore(),
  });
  live.watch(watch);
  live.watch({ ...watch, explicit: true });
  await live.tick();
  expect(policies).toEqual([false, true]);
  now += 23 * 60 * 60_000;
  live.watch({ explicit: true, locale: "en", renew: true, topics: [] });
  now += 2 * 60 * 60_000;
  await live.tick();
  expect(policies).toEqual([false, true, true]);
  live.stop();
});

test("busy refreshed scopes cannot starve older waiting interests", async () => {
  let now = 1_000_000;
  const read: string[] = [];
  const live = createDiscoveryLive({
    now: () => now,
    publish: () => Promise.resolve(),
    read: (scope) => {
      read.push(scope.topics[0] ?? "");
      return Promise.resolve({ cursor: null, items: [], partial: false });
    },
    store: new MemoryDiscoveryStore(),
  });
  for (const topic of ["anime", "software", "gardening", "science", "music"]) {
    live.watch({ ...watch, topics: [topic] });
  }
  await live.tick();
  now += 21_000;
  live.invalidate();
  now += 2100;
  await live.tick();
  await live.tick();
  expect(read.slice(0, 5)).toEqual([
    "anime",
    "software",
    "gardening",
    "science",
    "music",
  ]);
  live.stop();
});

test("viewers share reconciliation and unchanged heads do not emit events", async () => {
  let now = 1_000_000;
  let reads = 0;
  const events: string[] = [];
  const store = new MemoryDiscoveryStore();
  const live = createDiscoveryLive({
    now: () => now,
    publish: (_channel, message) => {
      events.push(message);
      return Promise.resolve();
    },
    read: () => {
      reads += 1;
      return Promise.resolve({ cursor: null, items: [], partial: false });
    },
    store,
  });
  for (let i = 0; i < 1000; i += 1) {
    live.watch(watch);
  }
  await Promise.all([live.tick(), live.tick()]);
  expect(reads).toBe(1);
  expect(events).toHaveLength(1);
  now += 21_000;
  await live.tick();
  expect(reads).toBe(2);
  expect(events).toHaveLength(1);
  now += 24 * 60 * 60_000 + 1;
  await live.tick();
  expect(reads).toBe(2);
  live.stop();
});

test("Jetstream wakes active pools and replica leases prevent duplicate concurrent reads", async () => {
  let now = 1_000_000;
  const pending = Promise.withResolvers<{
    cursor: null;
    items: [];
    partial: false;
  }>();
  let reads = 0;
  const store = new MemoryDiscoveryStore();
  const options = {
    now: () => now,
    publish: () => Promise.resolve(),
    read: () => {
      reads += 1;
      return pending.promise;
    },
    store,
  };
  const first = createDiscoveryLive(options);
  const second = createDiscoveryLive(options);
  first.watch(watch);
  second.watch(watch);
  const loading = Promise.all([first.tick(), second.tick()]);
  await Bun.sleep(1);
  expect(reads).toBe(1);
  pending.resolve({ cursor: null, items: [], partial: false });
  await loading;
  now += 6000;
  first.invalidate();
  now += 2001;
  await first.tick();
  expect(reads).toBe(2);
  first.stop();
  second.stop();
});

test("returning after twelve hours stays warm and a replacement worker restores anonymous scopes", async () => {
  let now = 1_000_000;
  const store = new MemoryDiscoveryStore();
  let reads = 0;
  const options = {
    now: () => now,
    publish: () => Promise.resolve(),
    read: () => {
      reads += 1;
      return Promise.resolve({ cursor: null, items: [], partial: false });
    },
    store,
  };
  const first = createDiscoveryLive(options);
  first.watch(watch);
  await first.tick();
  now += 12 * 60 * 60_000;
  await first.tick();
  expect(reads).toBe(2);
  first.stop();
  const replacement = createDiscoveryLive(options);
  now += 21_000;
  await replacement.tick();
  expect(reads).toBe(3);
  replacement.stop();
});
