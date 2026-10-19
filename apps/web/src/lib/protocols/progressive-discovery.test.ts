import { expect, test } from "bun:test";

import type { DiscoveryPage } from "@asm/protocols/discovery";

import {
  initialDiscoveryPosition,
  nextDiscoveryPosition,
  readProgressiveDiscovery,
} from "./progressive-discovery";

const empty: DiscoveryPage = { cursor: null, items: [], partial: false };

test("exhausted personalization advances through neighboring topics into broad discovery", () => {
  const related = nextDiscoveryPosition(initialDiscoveryPosition, empty);
  expect(related?.level).toBe(1);
  if (!related) {
    throw new Error("Expected related discovery");
  }
  const nextTopics = nextDiscoveryPosition(related, {
    ...empty,
    moreRelatedTopics: true,
  });
  expect(nextTopics?.topicPage).toBe(1);
  const broad = nextDiscoveryPosition(related, empty);
  expect(broad?.level).toBe(2);
  if (!broad) {
    throw new Error("Expected broader discovery");
  }
  expect(nextDiscoveryPosition(broad, empty)).toBeNull();
  expect(
    nextDiscoveryPosition(broad, { ...empty, cursor: "older" })?.cursor
  ).toBe("older");
});

test("one load traverses empty personalized and related pools with a bounded request count", async () => {
  const reads: number[] = [];
  const seen = new Set(["seen-on-home"]);
  const page = await readProgressiveDiscovery(
    {
      cursor: null,
      mode: "personalized",
      signal: new AbortController().signal,
    },
    initialDiscoveryPosition,
    seen,
    (options, known) => {
      expect(known).toBe(seen);
      reads.push(options.discoveryLevel ?? 0);
      return Promise.resolve(empty);
    }
  );
  expect(reads).toEqual([0, 1, 2]);
  expect(page.nextPosition).toBeNull();
});

test("endless empty related catalogs yield a continuation after three reads instead of spinning", async () => {
  let reads = 0;
  const page = await readProgressiveDiscovery(
    {
      cursor: null,
      mode: "personalized",
      signal: new AbortController().signal,
    },
    { cursor: null, level: 1, pages: 0, topicPage: 0 },
    new Set(),
    () => {
      reads += 1;
      return Promise.resolve({ ...empty, moreRelatedTopics: true });
    }
  );
  expect(reads).toBe(3);
  expect(page.nextPosition?.topicPage).toBe(3);
});

test("an upstream outage never broadens a focused profile into an unrelated fallback", async () => {
  let reads = 0;
  await expect(
    readProgressiveDiscovery(
      {
        cursor: null,
        mode: "personalized",
        signal: new AbortController().signal,
      },
      initialDiscoveryPosition,
      new Set(),
      () => {
        reads += 1;
        return Promise.resolve({ ...empty, partial: true });
      }
    )
  ).rejects.toThrow("temporarily unavailable");
  expect(reads).toBe(1);
});

test("configured interests stop at observed neighbors instead of recycling a universal feed", async () => {
  const reads: number[] = [];
  const page = await readProgressiveDiscovery(
    {
      cursor: null,
      mode: "personalized",
      signal: new AbortController().signal,
    },
    initialDiscoveryPosition,
    new Set(),
    (options) => {
      reads.push(options.discoveryLevel ?? 0);
      return Promise.resolve(empty);
    },
    1
  );
  expect(reads).toEqual([0, 1]);
  expect(page.nextPosition).toBeNull();
});

test("focused video cursors survive sparse pages and more than four loaded pages", async () => {
  let position = initialDiscoveryPosition;
  for (let index = 0; index < 20; index += 1) {
    const next = nextDiscoveryPosition(position, {
      ...empty,
      cursor: `video-${index}`,
    });
    expect(next?.level).toBe(0);
    expect(next?.cursor).toBe(`video-${index}`);
    if (!next) {
      throw new Error("A valid video cursor was discarded");
    }
    position = next;
  }
  expect(position.pages).toBe(20);
  let reads = 0;
  const page = await readProgressiveDiscovery(
    {
      content: "video",
      cursor: null,
      mode: "personalized",
      signal: new AbortController().signal,
    },
    position,
    new Set(),
    () => Promise.resolve({ ...empty, cursor: `still-more-${(reads += 1)}` }),
    1
  );
  expect(page.nextPosition?.level).toBe(0);
  expect(page.nextPosition?.cursor).toBe("still-more-1");
  expect(reads).toBe(1);
});

test("an unavailable independent generator does not discard a healthy sparse video cursor", async () => {
  const page = await readProgressiveDiscovery(
    {
      content: "video",
      cursor: null,
      mode: "personalized",
      signal: new AbortController().signal,
    },
    initialDiscoveryPosition,
    new Set(),
    () =>
      Promise.resolve({ ...empty, cursor: crypto.randomUUID(), partial: true }),
    1
  );
  expect(page.nextPosition?.level).toBe(0);
  expect(page.nextPosition?.cursor).toBeString();
});
