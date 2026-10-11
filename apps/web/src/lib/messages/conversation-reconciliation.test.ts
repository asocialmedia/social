import { describe, expect, test } from "bun:test";

import { createConversationReconciliationController } from "./conversation-reconciliation";

function deferred<T>() {
  const { promise, resolve } = Promise.withResolvers<T>();
  return { promise, resolve };
}

function timers() {
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
  const delays: number[] = [];
  return {
    cancel(timer: ReturnType<typeof setTimeout>) {
      clearTimeout(timer);
      pending.delete(timer);
    },
    delays,
    fire() {
      const next = pending.entries().next().value;
      if (!next) {
        throw new Error("No retry scheduled");
      }
      const [timer, callback] = next;
      clearTimeout(timer);
      pending.delete(timer);
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- the fake clock explicitly dispatches a scheduled timer callback
      callback();
    },
    pending,
    schedule(callback: () => void, delay: number) {
      const timer = setTimeout(() => {}, 60_000);
      pending.set(timer, callback);
      delays.push(delay);
      return timer;
    },
  };
}

describe("conversation reconciliation controller", () => {
  test("coalesces foreground and reconnect triggers into a follow-up replay", async () => {
    const first = deferred<boolean>();
    let calls = 0;
    const controller = createConversationReconciliationController({
      available: () => true,
      reconcile: () => {
        calls += 1;
        return calls === 1 ? first.promise : Promise.resolve(true);
      },
    });
    const initial = controller.request();
    await Promise.resolve();
    const reconnect = controller.request();
    for (let trigger = 0; trigger < 20; trigger += 1) {
      expect(controller.request()).toBe(initial);
    }
    first.resolve(true);
    expect(await reconnect).toBe(true);
    expect(calls).toBe(2);
    controller.dispose();
  });

  test("retries failures without overlapping requests and resets backoff after success", async () => {
    const clock = timers();
    let success = false;
    let calls = 0;
    const controller = createConversationReconciliationController({
      ...clock,
      available: () => true,
      reconcile: () => {
        calls += 1;
        return Promise.resolve(success);
      },
    });
    try {
      expect(await controller.request()).toBe(false);
      expect(clock.pending.size).toBe(1);
      clock.fire();
      await Bun.sleep(0);
      expect(clock.delays).toEqual([1000, 2000]);
      success = true;
      expect(await controller.request()).toBe(true);
      expect(clock.pending.size).toBe(0);
      success = false;
      expect(await controller.request()).toBe(false);
      expect(clock.delays.at(-1)).toBe(1000);
      expect(calls).toBe(4);
    } finally {
      controller.dispose();
    }
  });

  test("treats rejected replay work as retryable", async () => {
    const clock = timers();
    const controller = createConversationReconciliationController({
      ...clock,
      available: () => true,
      reconcile: () => Promise.reject(new Error("Connection lost")),
    });
    try {
      expect(await controller.request()).toBe(false);
      expect(clock.delays).toEqual([1000]);
    } finally {
      controller.dispose();
    }
  });

  test("does not run or retry while offline or hidden", async () => {
    const clock = timers();
    let available = true;
    let calls = 0;
    const controller = createConversationReconciliationController({
      ...clock,
      available: () => available,
      reconcile: () => {
        calls += 1;
        return Promise.resolve(false);
      },
    });
    try {
      await controller.request();
      available = false;
      clock.fire();
      expect(await controller.request()).toBe(false);
      expect(calls).toBe(1);
      expect(clock.pending.size).toBe(0);
      available = true;
      await controller.request();
      expect(calls).toBe(2);
    } finally {
      controller.dispose();
    }
  });

  test("yields between replay bursts instead of an unbounded immediate loop", async () => {
    const clock = timers();
    let calls = 0;
    const controller = createConversationReconciliationController({
      ...clock,
      available: () => true,
      reconcile: () => {
        calls += 1;
        void controller.request();
        return Promise.resolve(true);
      },
    });
    try {
      expect(await controller.request()).toBe(true);
      expect(calls).toBe(2);
      expect(clock.pending.size).toBe(1);
      clock.fire();
      await Bun.sleep(0);
      expect(calls).toBe(4);
      expect(clock.pending.size).toBe(1);
    } finally {
      controller.dispose();
    }
  });

  test("aborts old-scope work and never schedules a retry after disposal", async () => {
    const clock = timers();
    const pending = deferred<boolean>();
    let activeSignal: AbortSignal | undefined;
    const controller = createConversationReconciliationController({
      ...clock,
      available: () => true,
      reconcile: (signal) => {
        activeSignal = signal;
        return pending.promise;
      },
    });
    const request = controller.request();
    await Promise.resolve();
    controller.dispose();
    expect(activeSignal?.aborted).toBe(true);
    pending.resolve(true);
    expect(await request).toBe(false);
    expect(await controller.request()).toBe(false);
    expect(clock.pending.size).toBe(0);
  });

  test("leaves no retry timers after 100 conversation switches", async () => {
    const clock = timers();
    for (let scope = 0; scope < 100; scope += 1) {
      const controller = createConversationReconciliationController({
        ...clock,
        available: () => true,
        reconcile: () => Promise.resolve(false),
      });
      // oxlint-disable-next-line no-await-in-loop -- each switch disposes its previous scope before opening another
      await controller.request();
      controller.dispose();
    }
    expect(clock.pending.size).toBe(0);
  });
});
