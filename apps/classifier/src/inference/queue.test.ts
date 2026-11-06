import { expect, test } from "bun:test";

import { InferenceQueue } from "./queue";

test("a cancelled waiting job cannot pin the queue or execute later", async () => {
  const queue = new InferenceQueue(1);
  const gate = Promise.withResolvers<undefined>();
  const active = queue.run(() => gate.promise, new AbortController().signal);
  const controller = new AbortController();
  let ran = false;
  const waiting = queue.run(() => {
    ran = true;
    return Promise.resolve();
  }, controller.signal);
  controller.abort();
  await expect(waiting).rejects.toThrow();
  expect(queue.status().waiting).toBe(0);
  gate.resolve();
  await active;
  expect(ran).toBe(false);
  expect(
    await queue.run(() => Promise.resolve(42), new AbortController().signal)
  ).toBe(42);
});

test("failed inference releases its slot to the next job", async () => {
  const queue = new InferenceQueue(1);
  const gate = Promise.withResolvers<undefined>();
  const failed = queue.run(() => gate.promise, new AbortController().signal);
  const waiting = queue.run(
    () => Promise.resolve(42),
    new AbortController().signal
  );
  gate.reject(new Error("Inference unavailable"));
  await expect(failed).rejects.toThrow("Inference unavailable");
  expect(await waiting).toBe(42);
  expect(queue.status().active).toBe(0);
});
