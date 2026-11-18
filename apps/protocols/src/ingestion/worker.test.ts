// Async fixtures preserve the production transport and storage promise contracts.
// oxlint-disable require-await
import { expect, test } from "bun:test";

import { parseJetstreamEvent } from "@asm/protocols/jetstream";
import type { JetstreamEvent } from "@asm/protocols/jetstream";

import type { ProtocolsHealth } from "../http/app";
import type { CheckpointStore } from "./checkpoints";
import { runJetstreamWorker, waitForRetry } from "./worker";

const did = "did:web:example.test";
const event = (seq: number): JetstreamEvent =>
  parseJetstreamEvent(
    JSON.stringify({
      commit: {
        collection: "app.bsky.feed.post",
        operation: "delete",
        rkey: "removed",
      },
      did,
      kind: "commit",
      seq,
      time: "2026-10-16T10:00:00.000Z",
    })
  );

function fixture() {
  const health: ProtocolsHealth = {
    connected: false,
    draining: false,
    jetstreamEnabled: true,
    lastEventAt: null,
    leaseHeld: false,
    processedEvents: 0,
  };
  const controller = new AbortController();
  const logs: string[] = [];
  const logger = {
    debug: (_fields: Record<string, unknown>, message: string) => {
      logs.push(message);
    },
    error: (_fields: Record<string, unknown>, message: string) => {
      logs.push(message);
    },
    info: (_fields: Record<string, unknown>, message: string) => {
      logs.push(message);
    },
    warn: (_fields: Record<string, unknown>, message: string) => {
      logs.push(message);
    },
  };
  return { controller, health, logger, logs };
}

test("reconnects from committed progress and ignores duplicate delivery", async () => {
  const { health, controller, logger } = fixture();
  let cursor = 10;
  let attempts = 0;
  let invalidations = 0;
  const committed: number[] = [];
  const store: CheckpointStore = {
    acquire: async () => true,
    commit: async (item) => {
      committed.push(item.seq);
      cursor = item.seq;
    },
    load: async () => cursor,
    release: async () => {},
    renew: async () => true,
  };
  await runJetstreamWorker({
    health,
    invalidate: () => {
      invalidations += 1;
    },
    logger,
    signal: controller.signal,
    store,
    async *stream(options) {
      attempts += 1;
      options.onConnected?.();
      expect(options.cursor).toBe(attempts === 1 ? 10 : 11);
      yield event(10);
      yield event(11);
      if (attempts === 1) {
        throw new Error("connection lost");
      }
      yield event(12);
      controller.abort();
    },
    streamOptions: { dids: [did] },
    wait: async () => {},
  });
  expect(committed).toEqual([11, 12]);
  expect(invalidations).toBe(2);
  expect(health.processedEvents).toBe(2);
  expect(health.connected).toBe(false);
  expect(health.leaseHeld).toBe(false);
});

test("does not advance the cursor when processing fails", async () => {
  const { health, controller, logger } = fixture();
  let commits = 0;
  let attempts = 0;
  const cursors: (number | undefined)[] = [];
  const store: CheckpointStore = {
    acquire: async () => true,
    commit: async () => {
      commits += 1;
      throw new Error("Redis unavailable");
    },
    load: async () => 10,
    release: async () => {},
    renew: async () => true,
  };
  await runJetstreamWorker({
    health,
    invalidate: () => {},
    logger,
    signal: controller.signal,
    store,
    async *stream(options) {
      attempts += 1;
      cursors.push(options.cursor);
      yield event(11);
    },
    streamOptions: { dids: [did] },
    wait: async () => {
      if (attempts === 2) {
        controller.abort();
      }
    },
  });
  expect(cursors).toEqual([10, 10]);
  expect(commits).toBe(2);
  expect(health.processedEvents).toBe(0);
});

test("a standby instance never opens an additional stream", async () => {
  const { health, controller, logger } = fixture();
  let opened = false;
  const store: CheckpointStore = {
    acquire: async () => false,
    commit: async () => {},
    load: async () => {},
    release: async () => {},
    renew: async () => false,
  };
  await runJetstreamWorker({
    health,
    invalidate: () => {},
    logger,
    signal: controller.signal,
    store,
    async *stream() {
      opened = true;
      yield event(1);
    },
    streamOptions: { dids: [did] },
    wait: async () => {
      controller.abort();
    },
  });
  expect(opened).toBe(false);
});

test("events outside the configured account set cannot be checkpointed", async () => {
  const { health, controller, logger } = fixture();
  let committed = false;
  const store: CheckpointStore = {
    acquire: async () => true,
    commit: async () => {
      committed = true;
    },
    load: async () => {},
    release: async () => {},
    renew: async () => true,
  };
  await runJetstreamWorker({
    health,
    invalidate: () => {},
    logger,
    signal: controller.signal,
    store,
    async *stream() {
      yield event(1);
    },
    streamOptions: { dids: ["did:web:other.test"] },
    wait: async () => {
      controller.abort();
    },
  });
  expect(committed).toBe(false);
});

test("retry sleep is interrupted immediately on shutdown", async () => {
  const controller = new AbortController();
  const waiting = waitForRetry(30_000, controller.signal);
  controller.abort();
  await waiting;
  await waitForRetry(30_000, controller.signal);
});

test("lease renewal loss cancels the socket before another event is committed", async () => {
  const { health, controller, logger } = fixture();
  let renewals = 0;
  let releases = 0;
  let commits = 0;
  await runJetstreamWorker({
    health,
    invalidate: () => {},
    logger,
    renewEveryMs: 1,
    signal: controller.signal,
    store: {
      acquire: async () => true,
      commit: async () => {
        commits += 1;
      },
      load: async () => 10,
      release: async () => {
        releases += 1;
      },
      renew: async () => {
        renewals += 1;
        return false;
      },
    },
    async *stream(options) {
      options.onConnected?.();
      // oxlint-disable-next-line promise/avoid-new -- the socket fixture waits for lease cancellation.
      await new Promise<void>((resolve) => {
        options.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      yield event(11);
    },
    streamOptions: { dids: [did] },
    wait: async () => {
      controller.abort();
    },
  });
  expect(renewals).toBe(1);
  expect(commits).toBe(0);
  expect(releases).toBe(1);
  expect(health.connected).toBe(false);
  expect(health.leaseHeld).toBe(false);
});

// A stream that dies right after one frame used to reset the retry counter every
// time, so it retried at the one-second floor forever and logged a warning per
// attempt. The counter must survive a connection that never proves healthy.
test("a flapping stream backs off and stops warning on every attempt", async () => {
  const { health, controller, logger, logs } = fixture();
  let streamCalls = 0;
  let waits = 0;
  const options = {
    health,
    invalidate: () => {},
    logger,
    renewEveryMs: 60_000,
    signal: controller.signal,
    store: {
      acquire: async () => true,
      commit: async () => {},
      load: async () => 10,
      release: async () => {},
      renew: async () => true,
    },
    async *stream(streamOptions: { onConnected?: () => void }) {
      streamCalls += 1;
      streamOptions.onConnected?.();
      // One frame, then the socket drops.
      yield event(streamCalls + 10);
    },
    streamOptions: { dids: [did] },
    async wait(milliseconds: number) {
      waits = milliseconds;
      if (streamCalls >= 30) {
        controller.abort();
      }
    },
  };
  await runJetstreamWorker(options);

  const retryWarnings = logs.filter((line) =>
    line.includes("Jetstream paused; reconnecting from its checkpoint")
  ).length;
  // 30 drops must not produce 30 warnings.
  expect(retryWarnings).toBeLessThan(10);
  // Backoff must have moved past the one-second floor.
  expect(waits).toBeGreaterThan(1000);
  expect(health.connected).toBe(false);
});

test("checkpoints batch multiple events into one commit", async () => {
  const { health, controller, logger } = fixture();
  const committed: number[] = [];
  let invalidations = 0;
  const store: CheckpointStore = {
    acquire: async () => true,
    commit: async (item) => {
      committed.push(item.seq);
    },
    load: async () => 10,
    release: async () => {},
    renew: async () => true,
  };
  await runJetstreamWorker({
    health,
    invalidate: () => {
      invalidations += 1;
    },
    logger,
    signal: controller.signal,
    store,
    async *stream() {
      yield event(11);
      yield event(12);
      yield event(13);
      controller.abort();
    },
    streamOptions: { dids: [did] },
    wait: async () => {},
  });
  // One commit for the whole batch (the latest sequence), but every event
  // still flows through processing.
  expect(committed).toEqual([13]);
  expect(invalidations).toBe(3);
  expect(health.processedEvents).toBe(3);
});

test("cursor resets resume from live edge without an api key", async () => {
  const { health, controller, logger, logs } = fixture();
  let liveCalls = 0;
  let replays = 0;
  const store: CheckpointStore = {
    acquire: async () => true,
    commit: async () => {},
    load: async () => 100,
    release: async () => {},
    renew: async () => true,
    resetCursor: async () => {},
  };
  await runJetstreamWorker({
    health,
    invalidate: () => {},
    logger,
    async *replay() {
      replays += 1;
      yield event(1);
    },
    signal: controller.signal,
    store,
    // oxlint-disable-next-line require-yield -- mock throws before first frame
    async *stream() {
      liveCalls += 1;
      throw new Error("boom CursorTooOld");
    },
    streamOptions: { dids: [did] },
    wait: async () => {
      controller.abort();
    },
  });
  expect(liveCalls).toBe(1);
  expect(replays).toBe(0);
  expect(logs).toContain(
    "Jetstream cursor out of range or requires reconciliation; resuming from live edge"
  );
});

test("cursor resets replay missed events instead of resuming from live edge", async () => {
  const { health, controller, logger, logs } = fixture();
  const committed: number[] = [];
  const replayCalls: { afterSeq?: number; apiKey?: string }[] = [];
  let liveCalls = 0;
  let replayed = false;
  const store: CheckpointStore = {
    acquire: async () => true,
    commit: async (item) => {
      committed.push(item.seq);
    },
    load: async () => 100,
    release: async () => {},
    renew: async () => true,
    resetCursor: async () => {},
  };
  await runJetstreamWorker({
    apiKey: "test-key",
    health,
    invalidate: () => {},
    logger,
    async *replay(options: { afterSeq?: number; apiKey?: string }) {
      replayCalls.push({ afterSeq: options.afterSeq, apiKey: options.apiKey });
      yield event(101);
      yield event(102);
      replayed = true;
    },
    signal: controller.signal,
    store,
    // oxlint-disable-next-line require-yield -- mock throws before first frame
    async *stream() {
      liveCalls += 1;
      throw new Error("boom CursorTooOld");
    },
    streamOptions: { dids: [did] },
    wait: async () => {
      if (replayed) {
        controller.abort();
      }
    },
  });
  expect(liveCalls).toBe(1);
  expect(replayCalls).toEqual([{ afterSeq: 100, apiKey: "test-key" }]);
  // Batched checkpoint keeps only the latest sequence; both events processed.
  expect(committed).toEqual([102]);
  expect(health.processedEvents).toBe(2);
  expect(logs).toContain(
    "Jetstream cursor out of range; replaying missed events instead of resuming from live edge"
  );
  expect(logs).not.toContain(
    "Jetstream cursor out of range or requires reconciliation; resuming from live edge"
  );
});
