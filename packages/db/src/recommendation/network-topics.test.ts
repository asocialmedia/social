import { afterAll, expect, mock, test } from "bun:test";

import * as realRedis from "../redis";

const saved = new Map<string, string>();
const related = new Map<string, string[]>([
  ["Arbitrary root", ["First child", "Second child"]],
  ["First child", ["Nested subject"]],
]);
let requests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: string | URL | Request) => {
    await Promise.resolve();
    requests += 1;
    const url = new URL(String(input));
    if (url.searchParams.get("prop") === "pageprops") {
      return Response.json({
        query: { pages: [{ title: url.searchParams.get("titles") }] },
      });
    }
    if (url.searchParams.get("list") === "search") {
      const key =
        url.searchParams.get("srsearch")?.replace("morelike:", "") ?? "";
      return Response.json({
        query: { search: (related.get(key) ?? []).map((title) => ({ title })) },
      });
    }
    return Response.json({ query: { categorymembers: [] } });
  },
  { preconnect: originalFetch.preconnect }
);
mock.module("../redis", () => ({
  ...realRedis,
  redis: {
    ...realRedis.redis,
    get: (key: string) => Promise.resolve(saved.get(key) ?? null),
    set: (key: string, value: string) => {
      saved.set(key, value);
      return Promise.resolve("OK");
    },
    zrevrange: () =>
      Promise.resolve([
        "rec:topic-graph:v1:neighbors:Live%20Bluesky%20subject",
      ]),
  },
}));
mock.module("../messages/infrastructure/raw-sql", () => ({
  rawExecute: () => Promise.resolve({ count: 0, rows: [] }),
  rawQuery: () => Promise.resolve({ rows: [{ topic: "Local ASM subject" }] }),
}));
const { knowledgeTopicPage, networkTopicCatalog, networkTopicScope } =
  await import("./network-topics");
afterAll(() => {
  globalThis.fetch = originalFetch;
});

test("a cold feed has exact interests and never triggers provider reads", async () => {
  const scope = await networkTopicScope(["Unseen subject"], []);
  expect(scope.interests["Unseen subject"]).toEqual(["unseen subject"]);
  expect(requests).toBe(0);
});

test("on-demand expansion changes the scope through cached descendants without widening exclusions", async () => {
  await knowledgeTopicPage({ parent: "Arbitrary root" });
  await knowledgeTopicPage({ parent: "First child" });
  const first = await networkTopicScope(["Arbitrary root"], ["Arbitrary root"]);
  expect(first.interests["Arbitrary root"]).toContain("nested subject");
  expect(first.avoided["Arbitrary root"]).toEqual(["arbitrary root"]);
});

test("concurrent requests share upstream work and cached topic data", async () => {
  const before = requests;
  await Promise.all([
    knowledgeTopicPage({ parent: "Uncached branch" }),
    knowledgeTopicPage({ parent: "Uncached branch" }),
  ]);
  expect(requests - before).toBe(3);
});

test("autocomplete mixes real ASM tags and observed network subjects", async () => {
  const matches = await networkTopicCatalog("live");
  expect(matches.some((m) => m.label === "Live Bluesky subject")).toBe(true);
  const local = await networkTopicCatalog("local");
  expect(local.some((m) => m.label === "Local ASM subject")).toBe(true);
});
