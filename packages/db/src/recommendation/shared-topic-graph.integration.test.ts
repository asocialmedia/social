import { afterAll, expect, test } from "bun:test";

import { redis } from "../redis";
import {
  loadSharedTopicGraph,
  recordSharedTopicRelations,
} from "./shared-topic-graph";

const namespace = `test:topic-graph:${crypto.randomUUID()}:`;
afterAll(async () => {
  const keys = await redis.keys(`${namespace}*`);
  if (keys.length) {
    await redis.del(...keys);
  }
  redis.disconnect();
});

test("independent graph instances share Unicode relations and replay does not double-count", async () => {
  await recordSharedTopicRelations(
    ["日本語", "हिन्दी", "photography"],
    "document",
    namespace
  );
  await recordSharedTopicRelations(
    ["photography", "日本語", "हिन्दी"],
    "document",
    namespace
  );
  const untrusted = await loadSharedTopicGraph(["日本語"], namespace);
  expect(
    untrusted.spreadingActivation({ 日本語: 1 })["photography"]
  ).toBeUndefined();
  await recordSharedTopicRelations(
    ["日本語", "हिन्दी", "photography"],
    "document-two",
    namespace
  );
  await recordSharedTopicRelations(
    ["日本語", "हिन्दी", "photography"],
    "document-three",
    namespace
  );
  const first = await loadSharedTopicGraph(["日本語"], namespace);
  const second = await loadSharedTopicGraph(["日本語"], namespace);
  expect(first).not.toBe(second);
  expect(
    second.spreadingActivation({ 日本語: 1 })["photography"]
  ).toBeGreaterThan(0);
  const weight = await redis.zscore(
    `${namespace}neighbors:${encodeURIComponent("日本語")}`,
    "photography"
  );
  expect(Number(weight)).toBe(3);
});

test("shared topic neighborhoods stay bounded as unrelated documents accumulate", async () => {
  await Promise.all(
    Array.from({ length: 60 }, (_, index) =>
      recordSharedTopicRelations(
        ["bounded-root", `neighbor-${index}`],
        `bounded-${index}`,
        namespace
      )
    )
  );
  expect(await redis.zcard(`${namespace}neighbors:bounded-root`)).toBe(40);
  expect(await redis.ttl(`${namespace}neighbors:bounded-root`)).toBeGreaterThan(
    0
  );
});
