import { expect, test } from "bun:test";

import { ProtocolError } from "@asm/protocols/contracts";

import {
  hydrationRetryDelay,
  HydrationRescheduleError,
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
test("queue rejects invalid jobs and reschedules delayed work without refreshing its source fence", async () => {
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
  let rescheduled: HydrationRescheduleError | undefined;
  try {
    await runHydrationJob(
      { ids: [id], startedAt: 10_000 },
      hydrate,
      () => 80_000
    );
  } catch (error) {
    if (!(error instanceof HydrationRescheduleError)) {
      throw error;
    }
    rescheduled = error;
  }
  expect(rescheduled?.batch).toMatchObject({
    scheduledAt: 80_000,
    startedAt: 10_000,
  });
  expect(reads).toHaveLength(0);
  expect(await runHydrationJob(rescheduled?.batch, hydrate, () => 80_000)).toBe(
    1
  );
  await expect(
    runHydrationJob({ ids: [id], startedAt: 20_001 }, hydrate, () => 10_000)
  ).rejects.toThrow("Invalid protocol hydration timestamp");
  await expect(
    runHydrationJob(
      { ids: [id], scheduledAt: 310_001, startedAt: 10_000 },
      hydrate,
      () => 310_001
    )
  ).rejects.toThrow("lifetime expired");
  expect(
    await runHydrationJob(
      { ids: [id], startedAt: 10_000 },
      hydrate,
      () => 10_000
    )
  ).toBe(1);
  expect(reads).toEqual([[id], [id]]);
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
