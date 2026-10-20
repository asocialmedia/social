import { expect, test } from "bun:test";

import { ProtocolError } from "@asm/protocols/contracts";

import {
  hydrationRetryDelay,
  ingestionConnection,
  runHydrationJob,
} from "./ingestion-queue";

test("hydration waits out reader cooldowns instead of spending all retries inside them", () => {
  expect(
    hydrationRetryDelay(new ProtocolError("unavailable", "Recovering", 30))
  ).toBe(30_000);
  expect(hydrationRetryDelay(new ProtocolError("capacity", "Busy", 1))).toBe(
    1000
  );
  expect(
    hydrationRetryDelay(new ProtocolError("rate_limited", "Paused", 120))
  ).toBe(60_000);
  expect(
    hydrationRetryDelay(new ProtocolError("restricted", "Denied", 30))
  ).toBeUndefined();
  expect(hydrationRetryDelay(new Error("Unexpected failure"))).toBeUndefined();
});

const id = "at://did:plc:alice/app.bsky.feed.post/example";
test("queue rejects invalid jobs and expires old work before hydration", async () => {
  const reads: string[][] = [];
  const hydrate = (ids: string[]) => {
    reads.push(ids);
    return Promise.resolve(1);
  };
  await expect(
    runHydrationJob(
      { ids: ["https://evil.example"], startedAt: 10_000 },
      hydrate,
      () => 10_000
    )
  ).rejects.toThrow("Invalid protocol hydration batch");
  expect(
    await runHydrationJob(
      { ids: [id], startedAt: 10_000 },
      hydrate,
      () => 80_000
    )
  ).toBe(0);
  expect(
    await runHydrationJob(
      { ids: [id], startedAt: 20_001 },
      hydrate,
      () => 10_000
    )
  ).toBe(0);
  expect(reads).toHaveLength(0);
  expect(
    await runHydrationJob(
      { ids: [id], startedAt: 10_000 },
      hydrate,
      () => 10_000
    )
  ).toBe(1);
  expect(reads).toEqual([[id]]);
});

test("Redis queue connections preserve URL credentials, database and TLS", () => {
  const options = ingestionConnection(
    "rediss://worker:p%40ss@redis.example:7443/2"
  );
  expect(options).toMatchObject({
    db: 2,
    host: "redis.example",
    maxRetriesPerRequest: null,
    password: "p@ss",
    port: 7443,
    tls: {},
    username: "worker",
  });
});
