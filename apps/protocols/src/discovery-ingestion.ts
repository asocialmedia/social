// Hydration batches finish before their successor starts; the socket handler only enqueues IDs.
// oxlint-disable no-await-in-loop
import type { BlueskyClient } from "@asm/protocols/bluesky";
import { jetstreamRecordUri } from "@asm/protocols/jetstream";
import type { JetstreamEvent } from "@asm/protocols/jetstream";

import type { InventoryStore } from "./discovery-inventory";

export interface DiscoveryHydrationOptions {
  client: Pick<BlueskyClient, "getPosts" | "allowsRecommendations">;
  store: InventoryStore;
  publish: () => Promise<unknown>;
}

export async function hydrateDiscoveryBatch(
  options: DiscoveryHydrationOptions,
  ids: string[],
  startedAt: number
): Promise<number> {
  const posts = await options.client.getPosts(ids);
  const allowed = new Set<string>();
  const authors = [...new Set(posts.map((post) => post.author.id))];
  for (let offset = 0; offset < authors.length; offset += 6) {
    await Promise.all(
      authors.slice(offset, offset + 6).map(async (did) => {
        // Lookup failures must fail the batch so queue retries cannot silently omit authors.
        if (await options.client.allowsRecommendations(did)) {
          allowed.add(did);
        }
      })
    );
  }
  const permitted = posts.filter((post) => allowed.has(post.author.id));
  await options.store.put(permitted, startedAt);
  if (permitted.length) {
    await options.publish();
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
}) {
  const now = options.now ?? Date.now;
  const watches = new Map<
    string,
    { topics: string[]; expires: number; patterns: RegExp[] }
  >();
  const pending = new Map<string, number>();
  let running = false;
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
        options.client.invalidate(uri);
        await options.store.invalidate(uri);
        await options.publishInvalidation?.(event);
      }
      if (event.commit.operation === "delete") {
        return;
      }
      const text = JSON.stringify(event.commit.record ?? {}).toLowerCase();
      const active = [...watches.values()].filter(
        (watch) => watch.expires > now()
      );
      const matching = active.some((watch) =>
        watch.patterns.some((pattern) => pattern.test(text))
      );
      const video = text.includes("app.bsky.embed.video");
      const broad = active.some((watch) => watch.topics.length === 0);
      if (!active.length || (!matching && (!video || !broad))) {
        return;
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
      return pending.size;
    },
    async tick() {
      if (running || !pending.size) {
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
      const batch = [...focused, ...general].slice(0, 25);
      for (const [id] of batch) {
        pending.delete(id);
      }
      const startedAt = now();
      try {
        const ids = batch.map(([id]) => id);
        let dispatched = false;
        try {
          dispatched = (await options.dispatch?.(ids, startedAt)) ?? false;
        } catch {
          // Queue loss falls back to the existing local hydration path.
        }
        if (!dispatched) {
          await hydrateDiscoveryBatch(options, ids, startedAt);
        }
      } catch {
        // Bounded AppView failures retry through discovery reconciliation; raw posts remain invisible.
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
