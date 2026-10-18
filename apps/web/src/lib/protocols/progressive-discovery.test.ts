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
