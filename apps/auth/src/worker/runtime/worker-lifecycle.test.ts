import { describe, expect, mock, test } from "bun:test";

import {
  createWorkerPulse,
  createWorkerShutdown,
  messageWorkerErrorFields,
} from "./worker-lifecycle";

function deferred() {
  const pending = Promise.withResolvers<undefined>();
  return {
    promise: pending.promise,
    reject: pending.reject,
    resolve: () => pending.resolve(),
  };
}

describe("serialized worker maintenance", () => {
  test("coalesces repeated ticks during a Redis stall and resumes after completion", async () => {
    const blocked = deferred();
    const task = mock(() => blocked.promise);
    const reportError = mock();
    const pulse = createWorkerPulse(task, reportError);
    const first = pulse.run();
    const ticks = Array.from({ length: 1000 }, () => pulse.run());
    expect(ticks.every((tick) => tick === first)).toBe(true);
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    blocked.resolve();
    await first;
    await pulse.run();
    expect(task).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });

  test("reports asynchronous failures and accepts later retry ticks", async () => {
    const failure = new Error("connection unavailable");
    const task = mock(() => Promise.reject(failure));
    const reportError = mock();
    const pulse = createWorkerPulse(task, reportError);
    await pulse.run();
    await pulse.run();
    expect(task).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledWith(failure);
  });

  test("synchronous task and logging failures do not strand maintenance", async () => {
    const task = mock(() => {
      throw new Error("unavailable");
    });
    const pulse = createWorkerPulse(task, () => {
      throw new Error("logging unavailable");
    });
    await pulse.run();
    await pulse.run();
    expect(task).toHaveBeenCalledTimes(2);
  });

  test("disposal prevents queued work from starting", async () => {
    const task = mock(() => Promise.resolve());
    const pulse = createWorkerPulse(task, mock());
    const operation = pulse.run();
    await pulse.dispose();
    await operation;
    await pulse.run();
    expect(task).not.toHaveBeenCalled();
  });

  test("disposal waits for active work without allowing additional tasks", async () => {
    const blocked = deferred();
    const task = mock(() => blocked.promise);
    const pulse = createWorkerPulse(task, mock());
    const operation = pulse.run();
    await Promise.resolve();
    expect(pulse.dispose()).toBe(operation);
    await pulse.run();
    expect(task).toHaveBeenCalledTimes(1);
    blocked.resolve();
    await operation;
  });
});

describe("bounded worker shutdown", () => {
  test("repeated signals stop and drain once and cancel the deadline", async () => {
    const blocked = deferred();
    const stop = mock();
    const drain = mock(() => blocked.promise);
    const cancel = mock();
    const shutdown = createWorkerShutdown({
      drain,
      scheduleDeadline: () => cancel,
      stop,
      timeoutMs: 30_000,
    });
    const first = shutdown();
    expect(shutdown()).toBe(first);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledTimes(1);
    blocked.resolve();
    expect(await first).toBe("drained");
    expect(shutdown()).toBe(first);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("a stuck queue or stream exits at the configured deadline", async () => {
    const blocked = deferred();
    let expire: (() => void) | undefined;
    const cancel = mock();
    const shutdown = createWorkerShutdown({
      drain: () => blocked.promise,
      scheduleDeadline: (callback, timeout) => {
        expect(timeout).toBe(1200);
        expire = callback;
        return cancel;
      },
      stop: mock(),
      timeoutMs: 1200,
    });
    const operation = shutdown();
    await Promise.resolve();
    expect(expire).toBeDefined();
    expire?.();
    expect(await operation).toBe("timed-out");
    expect(cancel).toHaveBeenCalledTimes(1);
    // The race observes late drain rejection, avoiding an unhandled rejection after timeout.
    blocked.reject(new Error("late disconnect failure"));
    await Promise.resolve();
  });

  test("drain failures cancel the deadline and propagate to the process exit handler", async () => {
    const cancel = mock();
    const shutdown = createWorkerShutdown({
      drain: () => Promise.reject(new Error("close failed")),
      scheduleDeadline: () => cancel,
      stop: mock(),
      timeoutMs: 100,
    });
    await expect(shutdown()).rejects.toThrow("close failed");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("reentrant stop callbacks reuse the installed shutdown promise", async () => {
    let repeated: Promise<"drained" | "timed-out"> | undefined;
    const shutdown = createWorkerShutdown({
      drain: () => Promise.resolve(),
      stop: () => {
        repeated = shutdown();
      },
      timeoutMs: 100,
    });
    const operation = shutdown();
    expect(await operation).toBe("drained");
    expect(repeated).toBe(operation);
  });

  test("rejects invalid or unbounded deadlines", () => {
    for (const timeoutMs of [
      0,
      -1,
      120_001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
    ]) {
      expect(() =>
        createWorkerShutdown({
          drain: () => Promise.resolve(),
          stop: mock(),
          timeoutMs,
        })
      ).toThrow(RangeError);
    }
  });
});

describe("search-safe worker diagnostics", () => {
  test("keeps only allowlisted network and PostgreSQL error codes", () => {
    for (const code of [
      "ECONNRESET",
      "ETIMEDOUT",
      "23505",
      "40001",
      "XX000",
      "P0001",
    ]) {
      expect(
        messageWorkerErrorFields({
          code,
          detail: "private terms",
          message: "private message",
          stack: "private query",
        })
      ).toEqual({ errorCode: code });
    }
    expect(
      messageWorkerErrorFields({ code: "ignored", sqlState: "57014" })
    ).toEqual({ errorCode: "57014" });
  });

  test("never serializes unknown error messages, payloads or arbitrary codes", () => {
    for (const error of [
      new Error("secret"),
      "secret",
      null,
      { code: "private terms" },
      { sqlState: 23_505 },
      { key: "secret", message: "secret", query: "secret" },
    ]) {
      expect(messageWorkerErrorFields(error)).toEqual({ errorCode: "UNKNOWN" });
    }
  });
});
