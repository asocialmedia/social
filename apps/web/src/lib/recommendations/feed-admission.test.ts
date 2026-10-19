import { expect, test } from "bun:test";

import { admitFeedRead } from "./feed-admission";

test("navigation bursts wait within downstream capacity and cancelled queued work never starts", async () => {
  const release = Promise.withResolvers<boolean>();
  let active = 0;
  let maximum = 0;
  let started = 0;
  const reads = Array.from({ length: 64 }, () =>
    admitFeedRead(new Request("http://localhost/feed"), async () => {
      active += 1;
      started += 1;
      maximum = Math.max(maximum, active);
      await release.promise;
      active -= 1;
      return "loaded";
    })
  );
  const controller = new AbortController();
  let cancelledWorkStarted = false;
  const cancelled = admitFeedRead(
    new Request("http://localhost/feed", { signal: controller.signal }),
    () => {
      cancelledWorkStarted = true;
      return Promise.resolve("unexpected");
    }
  );
  controller.abort();
  await expect(cancelled).rejects.toBeDefined();
  expect(started).toBe(32);
  release.resolve(true);
  expect(await Promise.all(reads)).toHaveLength(64);
  expect(maximum).toBe(32);
  expect(cancelledWorkStarted).toBe(false);
});
