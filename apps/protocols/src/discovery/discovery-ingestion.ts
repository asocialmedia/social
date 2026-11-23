// Hydration batches finish before their successor starts; the socket handler only enqueues IDs.
// oxlint-disable no-await-in-loop
import type { BlueskyClient } from "@asm/protocols/bluesky";
import { ProtocolError } from "@asm/protocols/contracts";
import { BoundedReadQueue } from "@asm/protocols/discovery";
import { jetstreamRecordUri } from "@asm/protocols/jetstream";
import type { JetstreamEvent } from "@asm/protocols/jetstream";

import {
  hydrationLifetimeMs,
  hydrationRetryDelay,
} from "../ingestion/hydration-retry";
import type { InventoryStore } from "./discovery-inventory";

export interface DiscoveryHydrationOptions {
  client: Pick<BlueskyClient, "getPosts" | "allowsRecommendations">;
  store: InventoryStore;
  publish: () => Promise<unknown>;
}

export function createHydrationReader(
  client: DiscoveryHydrationOptions["client"],
  concurrency: number
) {
  const abort = new AbortController();
  const queue = new BoundedReadQueue({
    concurrency,
    maxQueued: 32,
    maxWaitMs: 2000,
  });
  const signal = () =>
    AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]);
  return {
    client: {
      allowsRecommendations: (did: string) =>
        queue.run(() => client.allowsRecommendations(did), signal()),
      getPosts: (ids: string[]) =>
        queue.run(() => client.getPosts(ids), signal()),
    },
    close() {
      abort.abort();
      queue.close();
    },
  };
}

export async function hydrateDiscoveryBatch(
  options: DiscoveryHydrationOptions,
  ids: string[],
  startedAt: number
): Promise<number> {
  const posts = await options.client.getPosts(ids);
  const allowed = new Set<string>();
  const authors = [...new Set(posts.map((post) => post.author.id))];
  let failure: PromiseRejectedResult | undefined;
  for (let offset = 0; offset < authors.length; offset += 6) {
    const checks = await Promise.allSettled(
      authors
        .slice(offset, offset + 6)
        .map(async (did) =>
          (await options.client.allowsRecommendations(did)) ? did : null
        )
    );
    for (const result of checks) {
      if (result.status === "fulfilled" && result.value) {
        allowed.add(result.value);
      } else if (
        result.status === "rejected" &&
        (!failure ||
          (hydrationRetryDelay(result.reason) ?? 0) >
            (hydrationRetryDelay(failure.reason) ?? 0))
      ) {
        failure = result;
      }
    }
    if (failure) {
      break;
    }
  }
  const permitted = posts.filter((post) => allowed.has(post.author.id));
  if (permitted.length || !failure) {
    await options.store.put(permitted, startedAt);
  }
  if (permitted.length > 0) {
    await options.publish();
  }
  if (failure) {
    // Keep verified arrivals and the original fence while the queue retries unresolved author checks.
    throw failure.reason;
  }
  return permitted.length;
}

export function createDiscoveryIngestion(options: {
  client: Pick<
    BlueskyClient,
    "getPosts" | "allowsRecommendations" | "invalidate"
  >;
  store: InventoryStore;
  publish: () => Promise<unknown>;
  publishInvalidation?: (event: JetstreamEvent) => Promise<unknown>;
  dispatch?: (ids: string[], startedAt: number) => Promise<boolean>;
  now?: () => number;
  logger?: {
    warn: (fields: Record<string, unknown>, message: string) => void;
  };
}) {
  const now = options.now ?? Date.now;
  const watches = new Map<
    string,
    { topics: string[]; expires: number; patterns: RegExp[] }
  >();
  const pending = new Map<string, number>();
  const retries: {
    ids: string[];
    startedAt: number;
    attempts: number;
    nextAt: number;
  }[] = [];
  let running = false;
  let nextGeneralAt = 0;
  let pausedUntil = 0;
  return {
    async event(event: JetstreamEvent) {
      if (event.kind !== "commit") {
        if (event.kind !== "sync") {
          options.client.invalidate(event.did);
          await options.store.invalidate(event.did);
          await options.publishInvalidation?.(event);
        }
        return;
      }
      const uri = jetstreamRecordUri(event);
      if (event.commit.collection !== "app.bsky.feed.post") {
        options.client.invalidate(event.did);
        await options.store.invalidate(event.did);
        await options.publishInvalidation?.(event);
        return;
      }
      if (event.commit.operation !== "create") {
        pending.delete(uri);
        for (const retry of retries) {
          retry.ids = retry.ids.filter((id) => id !== uri);
        }
        options.client.invalidate(uri);
        await options.store.invalidate(uri);
        await options.publishInvalidation?.(event);
      }
      if (event.commit.operation === "delete") {
        return;
      }
      const { record } = event.commit;
      if (
        !record ||
        typeof record !== "object" ||
        !("text" in record) ||
        typeof record.text !== "string"
      ) {
        return;
      }
      const { text } = record;
      const tags =
        "tags" in record && Array.isArray(record.tags)
          ? record.tags
              .slice(0, 8)
              .filter((tag): tag is string => typeof tag === "string")
          : [];
      const searchable = [text, ...tags].join(" ").toLowerCase();
      const active = [...watches.values()].filter(
        (watch) => watch.expires > now()
      );
      const matching = active.some((watch) =>
        watch.patterns.some((pattern) => pattern.test(searchable))
      );
      const embed = "embed" in record ? record.embed : null;
      const media =
        embed && typeof embed === "object" && "media" in embed
          ? embed.media
          : embed;
      const video =
        media !== null &&
        typeof media === "object" &&
        "$type" in media &&
        media.$type === "app.bsky.embed.video";
      if (
        !matching &&
        !(video && active.some((watch) => !watch.topics.length))
      ) {
        const at = now();
        // Keep a bounded sample of new public root posts warm even when nobody is online.
        if (
          at < nextGeneralAt ||
          pending.size >= 20 ||
          "reply" in record ||
          (!video && text.trim().length < 40) ||
          at - Date.parse(event.time) > 120_000
        ) {
          return;
        }
        nextGeneralAt = at + 2500;
      }
      // Interest matches displace general video traffic instead of waiting behind the full network.
      let priority = 1;
      if (matching) {
        priority = video ? 3 : 2;
      }
      if (pending.size >= 100 && priority > 1) {
        const lowest = [...pending.entries()].find(
          ([, value]) => value < priority
        );
        if (lowest) {
          pending.delete(lowest[0]);
        }
      }
      if (pending.size < 100) {
        pending.set(uri, priority);
      }
    },
    get pendingCount() {
      return (
        pending.size +
        retries.reduce((count, retry) => count + retry.ids.length, 0)
      );
    },
    async tick() {
      if (running || now() < pausedUntil) {
        return;
      }
      const timestamp = now();
      for (let index = retries.length - 1; index >= 0; index -= 1) {
        const retry = retries[index];
        if (!retry || !retry.ids.length) {
          retries.splice(index, 1);
        } else if (timestamp - retry.startedAt > hydrationLifetimeMs) {
          // Same outage case as the queue worker: the batch outwaited its
          // fence, so re-fence with a current timestamp instead of dropping
          // the posts. Attempt counts are preserved, so poison still dies.
          retry.startedAt = timestamp;
        }
      }
      const retry = retries.find((candidate) => candidate.nextAt <= timestamp);
      if (retry) {
        retries.splice(retries.indexOf(retry), 1);
      }
      if (!retry && (!pending.size || retries.length >= 4)) {
        return;
      }
      running = true;
      const prioritized = [...pending.entries()].toSorted(
        (a, b) => b[1] - a[1]
      );
      const focused = prioritized.filter(([, priority]) => priority > 1);
      const general = prioritized
        .filter(([, priority]) => priority === 1)
        .slice(0, 5);
      const batch = retry ? [] : [...focused, ...general].slice(0, 25);
      for (const [id] of batch) {
        pending.delete(id);
      }
      const startedAt = retry?.startedAt ?? timestamp;
      const ids = retry?.ids ?? batch.map(([id]) => id);
      const attempts = (retry?.attempts ?? 0) + 1;
      try {
        let dispatched = false;
        try {
          dispatched = (await options.dispatch?.(ids, startedAt)) ?? false;
        } catch {
          // Queue loss falls back to the existing local hydration path.
        }
        if (!dispatched) {
          await hydrateDiscoveryBatch(options, ids, startedAt);
        }
      } catch (error) {
        const delay = hydrationRetryDelay(error);
        if (
          error instanceof ProtocolError &&
          error.code === "rate_limited" &&
          delay
        ) {
          pausedUntil = now() + delay;
        }
        // Retain at most four batches for three attempts, with the original invalidation fence.
        if (
          attempts < 3 &&
          retries.length < 4 &&
          now() - startedAt < hydrationLifetimeMs
        ) {
          retries.push({
            attempts,
            ids,
            nextAt: now() + (delay ?? 1000 * 2 ** (attempts - 1)),
            startedAt,
          });
        } else {
          // Retries are bounded; surface the drop instead of pruning silently.
          let reason = "lifetime_expired";
          if (attempts >= 3) {
            reason = "attempts_exhausted";
          } else if (retries.length >= 4) {
            reason = "retry_queue_full";
          }
          options.logger?.warn(
            {
              attempts,
              batchSize: ids.length,
              event: "ingestion.local_retry_exhausted",
              reason,
            },
            "Protocol hydration batch dropped after exhausting local retries"
          );
        }
      } finally {
        running = false;
      }
    },
    watch(topics: string[]) {
      for (const [key, watch] of watches) {
        if (watch.expires < now()) {
          watches.delete(key);
        }
      }
      const key = JSON.stringify(topics);
      if (watches.size < 64 || watches.has(key)) {
        watches.set(key, {
          expires: now() + 300_000,
          patterns: topics.map(
            (topic) =>
              new RegExp(
                `(?:^|[^\\p{L}\\p{N}_])${topic.toLowerCase().replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}_])`,
                "u"
              )
          ),
          topics,
        });
      }
    },
  };
}
