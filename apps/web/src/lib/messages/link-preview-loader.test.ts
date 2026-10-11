import { expect, test } from "bun:test";

import { createPreviewQueue } from "./link-preview-loader";

test("previews are bounded and start in submission order", async () => {
  const enqueue = createPreviewQueue(1);
  const started: number[] = [];
  const release = Promise.withResolvers<undefined>();
  const { signal } = new AbortController();
  const first = enqueue(async () => {
    started.push(1);
    await release.promise;
  }, signal);
  const second = enqueue(() => {
    started.push(2);
    return Promise.resolve();
  }, signal);
  expect(started).toEqual([1]);
  release.resolve();
  await Promise.all([first, second]);
  expect(started).toEqual([1, 2]);
});

test("a row unmounted while queued never fetches", async () => {
  const enqueue = createPreviewQueue(1);
  const release = Promise.withResolvers<undefined>();
  const first = enqueue(() => release.promise, new AbortController().signal);
  const controller = new AbortController();
  let fetched = false;
  const second = enqueue(() => {
    fetched = true;
    return Promise.resolve();
  }, controller.signal);
  controller.abort();
  await expect(second).rejects.toBeDefined();
  release.resolve();
  await first;
  expect(fetched).toBe(false);
});
