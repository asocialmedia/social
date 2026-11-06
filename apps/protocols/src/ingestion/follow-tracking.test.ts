import { expect, test } from "bun:test";

import { readConfig } from "../runtime/config";
import {
  FollowSubscriptionSupervisor,
  partitionTrackedDids,
} from "./follow-tracking";

test("DID partitions stay bounded, unique and deterministic; empty means no subscription", () => {
  expect(partitionTrackedDids([])).toEqual([]);
  expect(
    partitionTrackedDids(["did:web:b.test", "did:web:a.test", "did:web:a.test"])
  ).toEqual([["did:web:a.test", "did:web:b.test"]]);
  const shards = partitionTrackedDids(
    Array.from({ length: 2001 }, (_, i) => `did:web:actor-${i}.test`)
  );
  expect(shards.map((shard) => shard.length)).toEqual([1000, 1000, 1]);
  expect(() => partitionTrackedDids(["invalid"])).toThrow();
  expect(() =>
    partitionTrackedDids(
      Array.from({ length: 17_001 }, (_, i) => `did:web:${i}.test`)
    )
  ).toThrow();
});

test("subscription changes cancel old workers before replacement and never open a firehose", async () => {
  const started: string[][] = [];
  const stopped: string[][] = [];
  const supervisor = new FollowSubscriptionSupervisor((dids, signal) => {
    started.push(dids);
    const done = Promise.withResolvers<undefined>();
    signal.addEventListener(
      "abort",
      () => {
        stopped.push(dids);
        done.resolve();
      },
      { once: true }
    );
    return done.promise;
  });
  await supervisor.sync([]);
  await supervisor.sync(["did:web:a.test"]);
  await supervisor.sync(["did:web:a.test"]);
  expect(started).toHaveLength(1);
  await supervisor.sync(["did:web:b.test"]);
  expect(stopped).toEqual([["did:web:a.test"]]);
  await supervisor.sync([]);
  expect(stopped).toHaveLength(2);
  await supervisor.stop();
});

test("dynamic tracking starts without an environment DID list but requires a trusted registry and credentials", () => {
  const config = readConfig({
    PROTOCOLS_ASM_URL: "http://asm:3000",
    PROTOCOLS_INTERNAL_TOKEN: "a".repeat(32),
    PROTOCOLS_JETSTREAM_ENABLED: "true",
    REDIS_URL: "redis://localhost:6379",
  });
  expect(config.dids).toEqual([]);
  expect(config.asmUrl).toBe("http://asm:3000");
  expect(() =>
    readConfig({ PROTOCOLS_ASM_URL: "file:///etc/passwd" })
  ).toThrow();
  expect(() =>
    readConfig({
      PROTOCOLS_ASM_URL: "http://asm:3000",
      PROTOCOLS_JETSTREAM_ENABLED: "true",
      REDIS_URL: "redis://localhost:6379",
    })
  ).toThrow();
});
