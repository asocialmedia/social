import { expect, test } from "bun:test";

import type { SharedReadStore } from "@asm/protocols/discovery";

import { createSuggestionPublicSearch } from "./public-search-cache";

function memoryStore(): SharedReadStore {
  const values = new Map<string, string>();
  const owners = new Map<string, string>();
  return {
    claim: (key, owner) => {
      if (owners.has(key)) {
        return Promise.resolve(false);
      }
      owners.set(key, owner);
      return Promise.resolve(true);
    },
    commit: (key, owner, value) => {
      if (owners.get(key) !== owner) {
        return Promise.resolve(false);
      }
      values.set(key, value);
      owners.delete(key);
      return Promise.resolve(true);
    },
    get: (key) => Promise.resolve(values.get(key) ?? null),
    release: (key) => Promise.resolve(owners.delete(key)),
  };
}

test("one thousand callers share public retrieval without mixing content policies", async () => {
  const calls: (boolean | undefined)[] = [];
  const read = createSuggestionPublicSearch(
    memoryStore(),
    (_term, _signal, _id, _kind, explicit) => {
      calls.push(explicit);
      return Promise.resolve({ posts: [], profiles: [], unavailable: [] });
    }
  );
  await Promise.all(
    Array.from({ length: 1000 }, (_, index) =>
      read(
        " Engineering ",
        index % 2 === 0,
        new AbortController().signal,
        String(index)
      )
    )
  );
  expect(calls.toSorted()).toEqual([false, true]);
});

test("a disconnected first caller does not cancel the shared provider read", async () => {
  let providerSignal: AbortSignal | undefined;
  const finished = Promise.withResolvers<boolean>();
  const ready = Promise.withResolvers<boolean>();
  const read = createSuggestionPublicSearch(
    memoryStore(),
    async (_term, signal) => {
      providerSignal = signal;
      ready.resolve(true);
      await finished.promise;
      return { posts: [], profiles: [], unavailable: [] };
    }
  );
  const first = new AbortController();
  const pending = read("software", false, first.signal, "first").catch(
    () => null
  );
  await ready.promise;
  const retained = read(
    "software",
    false,
    new AbortController().signal,
    "second"
  );
  first.abort();
  expect(providerSignal?.aborted).toBe(false);
  finished.resolve(true);
  expect(await retained).toEqual({ posts: [], profiles: [], unavailable: [] });
  await pending;
});
