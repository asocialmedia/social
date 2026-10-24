import { expect, test } from "bun:test";

import { normalizePost } from "./bluesky/normalize";
import { postViewSchema } from "./bluesky/schemas";
import { readDiscoveryWindow } from "./discovery";
import { createFeedReadScheduler, feedChangeSchema } from "./feed-events";
import { postFixture } from "./testing/fixtures";

test("a burst coalesces and an event during a read schedules exactly one follow-up", async () => {
  const first = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  const completed = Promise.withResolvers<undefined>();
  let calls = 0;
  const scheduler = createFeedReadScheduler(async () => {
    calls += 1;
    if (calls === 1) {
      started.resolve();
      await first.promise;
    } else {
      completed.resolve();
    }
  }, 1);
  for (let i = 0; i < 1000; i += 1) {
    scheduler.schedule();
  }
  await started.promise;
  expect(calls).toBe(1);
  for (let i = 0; i < 1000; i += 1) {
    scheduler.schedule();
  }
  first.resolve();
  await completed.promise;
  scheduler.stop();
  expect(calls).toBe(2);
});

test("unsubscribe cancels pending work and ignores later hints", async () => {
  let calls = 0;
  const scheduler = createFeedReadScheduler(() => {
    calls += 1;
    return Promise.resolve();
  }, 1);
  scheduler.schedule();
  scheduler.stop();
  scheduler.schedule();
  await Bun.sleep(10);
  expect(calls).toBe(0);
  expect(feedChangeSchema.safeParse({ source: "forged" }).success).toBe(false);
});

test("load-more skips empty and duplicate pages without restarting the visible feed", async () => {
  const known = normalizePost(postViewSchema.parse(postFixture));
  const fresh = { ...known, id: `${known.id}2` };
  const pages = [
    { cursor: "second", items: [known], partial: false },
    { cursor: "third", items: [], partial: false },
    { cursor: "fourth", items: [fresh], partial: false },
  ];
  const cursors: (string | null)[] = [];
  const result = await readDiscoveryWindow(
    {
      cursor: "first",
      fetch: (url) => {
        cursors.push(
          new URL(url, "https://asm.test").searchParams.get("cursor")
        );
        return Promise.resolve(Response.json(pages.shift()));
      },
      mode: "latest",
      signal: new AbortController().signal,
    },
    new Set([known.id])
  );
  expect(cursors).toEqual(["first", "second", "third"]);
  expect(result.items.map((item) => item.id)).toEqual([fresh.id]);
  expect(result.cursor).toBe("fourth");
});
