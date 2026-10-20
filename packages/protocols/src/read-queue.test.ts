import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import { BoundedReadQueue } from "./read-queue";

test("read queue bounds active work, queues bursts, and rejects excess work with a retry hint", async () => {
  const queue = new BoundedReadQueue({
    concurrency: 1,
    maxQueued: 1,
    maxWaitMs: 1000,
  });
  const first = Promise.withResolvers<number>();
  const active = queue.run(() => first.promise, new AbortController().signal);
  let started = false;
  const waiting = queue.run(() => {
    started = true;
    return Promise.resolve(2);
  }, new AbortController().signal);
  await expect(
    queue.run(() => Promise.resolve(3), new AbortController().signal)
  ).rejects.toMatchObject({ code: "capacity", retryAfterSeconds: 1 });
  expect(started).toBe(false);
  expect(queue.stats).toEqual({ active: 1, queued: 1, rejected: 1 });
  first.resolve(1);
  expect(await active).toBe(1);
  expect(await waiting).toBe(2);
  expect(queue.stats.active).toBe(0);
});

test("cancelling queued work removes it without releasing an occupied upstream slot", async () => {
  const queue = new BoundedReadQueue({
    concurrency: 1,
    maxQueued: 2,
    maxWaitMs: 1000,
  });
  const first = Promise.withResolvers<number>();
  const activeAbort = new AbortController();
  const active = queue.run(() => first.promise, activeAbort.signal);
  const queuedAbort = new AbortController();
  let started = false;
  const waiting = queue.run(() => {
    started = true;
    return Promise.resolve(2);
  }, queuedAbort.signal);
  queuedAbort.abort();
  await expect(waiting).rejects.toBeInstanceOf(Error);
  activeAbort.abort();
  await expect(active).rejects.toBeInstanceOf(Error);
  expect(queue.stats).toMatchObject({ active: 1, queued: 0 });
  first.resolve(1);
  await delay(0);
  expect(started).toBe(false);
  expect(queue.stats.active).toBe(0);
});

test("queue wait and shutdown are bounded", async () => {
  const queue = new BoundedReadQueue({
    concurrency: 1,
    maxQueued: 2,
    maxWaitMs: 20,
  });
  const first = Promise.withResolvers<number>();
  const active = queue.run(() => first.promise, new AbortController().signal);
  await expect(
    queue.run(() => Promise.resolve(2), new AbortController().signal)
  ).rejects.toMatchObject({ code: "capacity" });
  expect(queue.stats.queued).toBe(0);
  const queued = queue.run(
    () => Promise.resolve(2),
    new AbortController().signal
  );
  queue.close();
  await expect(queued).rejects.toBeInstanceOf(Error);
  await expect(
    queue.run(() => Promise.resolve(2), new AbortController().signal)
  ).rejects.toMatchObject({ code: "cancelled" });
  first.resolve(1);
  await active;
});
