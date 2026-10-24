// oxlint-disable no-await-in-loop -- subscription replacement and reconciliation are ordered.
import { readBlueskyAccountStatus } from "@asm/protocols/bluesky";
import type { BlueskyClient } from "@asm/protocols/bluesky";
import {
  FEED_EVENTS_CHANNEL,
  readJsonBounded,
  recordPublicSocialEvent,
  recordPublicSocialSnapshot,
} from "@asm/protocols/discovery";
import type { JetstreamEvent } from "@asm/protocols/jetstream";
import type Redis from "ioredis";
import { z } from "zod";

import type { ProtocolsHealth } from "./app";
import { RedisCheckpointStore } from "./checkpoints";
import type { ProtocolsConfig } from "./config";
import type { ProtocolLogger } from "./observability";
import { runJetstreamWorker, waitForRetry } from "./worker";

const didSchema = z
  .string()
  .max(2048)
  .regex(/^did:(?:plc|web):[A-Za-z0-9._:%-]+$/);
const registrySchema = z.object({
  dids: z.array(didSchema).max(16_000),
  reconcile: z.array(didSchema).max(20),
});

export function partitionTrackedDids(dids: string[]) {
  const unique = [
    ...new Set(dids.map((did) => didSchema.parse(did))),
  ].toSorted();
  if (unique.length > 17_000) {
    throw new RangeError("Tracked account capacity exceeded");
  }
  const result: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += 1000) {
    result.push(unique.slice(offset, offset + 1000));
  }
  return result;
}

export class FollowSubscriptionSupervisor {
  private readonly shards = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >();
  private readonly start: (
    dids: string[],
    signal: AbortSignal
  ) => Promise<void>;
  constructor(start: (dids: string[], signal: AbortSignal) => Promise<void>) {
    this.start = start;
  }

  async sync(dids: string[]) {
    const partitions = partitionTrackedDids(dids);
    const next = new Set(partitions.map((partition) => partition.join(",")));
    for (const [key, shard] of this.shards) {
      if (!next.has(key)) {
        shard.abort.abort();
        await shard.done;
        this.shards.delete(key);
      }
    }
    for (const partition of partitions) {
      const key = partition.join(",");
      if (!this.shards.has(key)) {
        const abort = new AbortController();
        const done = this.start(partition, abort.signal);
        this.shards.set(key, { abort, done });
      }
    }
  }

  async stop() {
    for (const shard of this.shards.values()) {
      shard.abort.abort();
    }
    await Promise.all([...this.shards.values()].map((shard) => shard.done));
    this.shards.clear();
  }
}

export async function runFollowTracking(options: {
  config: ProtocolsConfig;
  redis: Redis;
  client: BlueskyClient;
  health: ProtocolsHealth;
  logger: ProtocolLogger;
  signal: AbortSignal;
  invalidate: (event?: JetstreamEvent) => void;
}) {
  const { config, redis, signal } = options;
  const registryUrl = config.asmUrl
    ? new URL("/api/internal/protocols/follows", config.asmUrl)
    : null;
  const headers = { authorization: `Bearer ${config.token}` };
  const readRegistry = async () => {
    if (!registryUrl) {
      return { dids: [], reconcile: [] };
    }
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(10_000),
    ]);
    const response = await fetch(registryUrl, {
      cache: "no-store",
      headers,
      redirect: "error",
      signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`ASM follow registry HTTP ${response.status}`);
    }
    return registrySchema.parse(
      await readJsonBounded(response, 4 * 1024 * 1024, requestSignal)
    );
  };
  const reconcile = async (dids: string[]) => {
    if (!registryUrl || !dids.length) {
      return;
    }
    const reports = await Promise.all(
      dids.map(async (did) => {
        const status = await readBlueskyAccountStatus(did, signal);
        if (status === "active") {
          options.client.invalidate(did);
          const profile = await options.client
            .getProfile(did)
            .catch(() => null);
          return {
            did,
            status,
            ...(profile
              ? { displayName: profile.displayName, handle: profile.handle }
              : {}),
          };
        }
        return { did, status };
      })
    );
    const response = await fetch(registryUrl, {
      body: JSON.stringify(reports),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw new Error(`ASM lifecycle reconciliation HTTP ${response.status}`);
    }
  };
  const followedCollections = [
    "app.bsky.feed.post",
    "app.bsky.actor.profile",
    "app.bsky.actor.contentVisibilityDeclaration",
    "app.bsky.feed.threadgate",
    "app.bsky.feed.postgate",
    "app.bsky.feed.like",
    "app.bsky.feed.repost",
    "app.bsky.graph.follow",
  ];
  const shardHealth = new Set<ProtocolsHealth>();
  const changedAuthors = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const supervisor = new FollowSubscriptionSupervisor(
    async (dids, shardSignal) => {
      const health = {
        ...options.health,
        connected: false,
        leaseHeld: false,
        processedEvents: 0,
      };
      shardHealth.add(health);
      try {
        await runJetstreamWorker({
          health,
          invalidate: (event) => {
            options.invalidate(event);
            if (event) {
              changedAuthors.add(event.did);
            }
            flushTimer ??= setTimeout(() => {
              flushTimer = undefined;
              const authors = [...changedAuthors];
              for (let offset = 0; offset < authors.length; offset += 1000) {
                void redis
                  .publish(
                    FEED_EVENTS_CHANNEL,
                    JSON.stringify({
                      authorIds: authors.slice(offset, offset + 1000),
                      source: "bluesky-following",
                    })
                  )
                  .catch(() => null);
              }
              changedAuthors.clear();
            }, 1000);
          },
          logger: options.logger,
          processEvent: async (event) => {
            await recordPublicSocialEvent(redis, event);
            if (event.kind === "account" || event.kind === "identity") {
              await reconcile([event.did]);
            }
          },
          signal: AbortSignal.any([signal, shardSignal]),
          store: new RedisCheckpointStore(redis, {
            collections: followedCollections,
            dids,
            endpoint: config.endpoint,
            leaseMs: 10_000,
          }),
          streamOptions: {
            collections: followedCollections,
            dids,
            endpoint: config.endpoint,
          },
        });
      } finally {
        shardHealth.delete(health);
      }
    }
  );
  let bootstrapOffset = 0;
  const healthTimer = setInterval(() => {
    const all = [...shardHealth];
    options.health.connected =
      all.length > 0 &&
      all.every((health) => health.connected || !health.leaseHeld);
    options.health.leaseHeld = all.some((health) => health.leaseHeld);
    options.health.processedEvents = all.reduce(
      (total, health) => total + health.processedEvents,
      0
    );
    options.health.lastEventAt =
      Math.max(0, ...all.map((health) => health.lastEventAt ?? 0)) || null;
  }, 1000);
  healthTimer.unref();
  try {
    // Curated seeds remain usable while the ASM registry recovers.
    await supervisor.sync(config.jetstreamEnabled ? config.dids : []);
    while (!signal.aborted) {
      try {
        const registry = await readRegistry();
        await supervisor.sync(
          config.jetstreamEnabled ? [...config.dids, ...registry.dids] : []
        );
        await reconcile(registry.reconcile);
        const pending = registry.dids.slice(
          bootstrapOffset,
          bootstrapOffset + 6
        );
        bootstrapOffset =
          bootstrapOffset + 6 >= registry.dids.length ? 0 : bootstrapOffset + 6;
        for (let offset = 0; offset < pending.length; offset += 2) {
          await Promise.all(
            pending.slice(offset, offset + 2).map(async (did) => {
              const key = `asm:public-social:bootstrap:${did}`;
              const owner = crypto.randomUUID();
              if (
                (await redis.get(key)) ||
                (await redis.set(`${key}:lease`, owner, "EX", 60, "NX")) !==
                  "OK"
              ) {
                return;
              }
              try {
                const records =
                  await options.client.getPublicSocialRecords(did);
                await recordPublicSocialSnapshot(redis, did, records);
                await redis.set(key, "ready", "EX", 6 * 60 * 60);
              } catch {
                // A missing or temporarily unavailable public repository retries on a later registry pass.
              } finally {
                await redis.eval(
                  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
                  1,
                  `${key}:lease`,
                  owner
                );
              }
            })
          );
        }
      } catch (error) {
        if (!signal.aborted) {
          options.logger.warn(
            {
              event: "jetstream.registry_retry",
              reason:
                error instanceof Error
                  ? error.message.slice(0, 160)
                  : "unknown",
            },
            "ASM follow tracking will retry; existing subscriptions remain active"
          );
        }
      }
      await waitForRetry(30_000, signal);
    }
  } finally {
    clearInterval(healthTimer);
    clearTimeout(flushTimer);
    await supervisor.stop();
    options.health.connected = false;
    options.health.leaseHeld = false;
  }
}
