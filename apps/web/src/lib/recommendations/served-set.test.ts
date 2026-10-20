import { expect, mock, test } from "bun:test";

const store = new Map<string, Map<string, number>>();
const multi = () => {
  const pending: (() => void)[] = [];
  const api = {
    exec: () => {
      for (const run of pending) {
        run();
      }
      return [];
    },
    expire: () => api,
    zadd: (key: string, score: string, member: string) => {
      pending.push(() => {
        const entries = store.get(key) ?? new Map<string, number>();
        entries.set(member, Number(score));
        store.set(key, entries);
      });
      return api;
    },
    zremrangebyrank: () => api,
  };
  return api;
};

mock.module("@asm/db", () => ({
  redis: {
    multi,
    zrange: (key: string, start: string, stop: string) => {
      const entries = [...(store.get(key) ?? new Map<string, number>())]
        .toSorted((a, b) => a[1] - b[1])
        .map(([member]) => member);
      const from = Number(start);
      const to = Number(stop);
      return entries.slice(
        from < 0 ? from : from,
        to === -1 ? undefined : to + 1
      );
    },
  },
}));

const { readServedIds, recordServedIds } = await import("./served-set");

test("a viewer's served ids survive and stay isolated per surface", async () => {
  store.clear();
  await recordServedIds("viewer-a", "post:personalized", ["one", "two"]);
  expect(await readServedIds("viewer-a", "post:personalized")).toEqual([
    "one",
    "two",
  ]);
  // Another surface of the same viewer must not inherit this page's history.
  expect(await readServedIds("viewer-a", "gust:personalized")).toEqual([]);
  // Another viewer must not inherit it either.
  expect(await readServedIds("viewer-b", "post:personalized")).toEqual([]);
});

test("recording the same id twice does not duplicate it", async () => {
  store.clear();
  await recordServedIds("viewer-a", "post:personalized", ["one"]);
  await recordServedIds("viewer-a", "post:personalized", ["one", "two"]);
  expect(await readServedIds("viewer-a", "post:personalized")).toEqual([
    "one",
    "two",
  ]);
});

test("guests and empty pages skip the round trip", async () => {
  store.clear();
  await recordServedIds("", "post:personalized", ["one"]);
  await recordServedIds("viewer-a", "post:personalized", []);
  expect(store.size).toBe(0);
  expect(await readServedIds("", "post:personalized")).toEqual([]);
});
