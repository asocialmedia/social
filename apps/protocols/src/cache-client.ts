import { createHash } from "node:crypto";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import type Redis from "ioredis";

// Shared read cache for public Bluesky reads.
// The dominant cold-feed cost is the per-author `contentVisibilityDeclaration`
// check: one extra HTTP round trip for every author on every cold page, which
// was cached only inside one process for 30s. This layer shares those decisions
// across replicas so a cold page usually pays for authors nobody has seen yet,
// not for every author on the page.
const visibilityTtlSeconds = 120;
const profileTtlSeconds = 300;
const postsTtlSeconds = 180;
const threadTtlSeconds = 180;
// Source pages are shared for a minute while Jetstream replenishes the local inventory.
// Cursor pages stay stable longer so scrolling does not rebuild the same upstream work.
const feedTtlSeconds = 60;
const cursorFeedTtlSeconds = 180;
const suggestedFeedsTtlSeconds = 60;

interface CacheEnvelope {
  at: number;
  value: unknown;
}

function isEnvelope(value: unknown): value is CacheEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "at" in value &&
    typeof value.at === "number" &&
    "value" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createCachedBlueskyClient(
  client: BlueskyClient,
  redis?: Redis,
  scope = "asm:protocols:cache:safe-v2"
): BlueskyClient {
  if (!redis) {
    return client;
  }

  let generation = 0;
  const targetInvalidations = new Map<string, number>();
  const pending = new Map<string, Promise<unknown>>();
  // Captured after the guard above so the nested closures keep the narrow type.
  const store = redis;

  function pruneInvalidations() {
    if (targetInvalidations.size <= 1000) {
      return;
    }
    const cutoff = Date.now() - 300_000;
    for (const [target, time] of targetInvalidations) {
      if (time < cutoff) {
        targetInvalidations.delete(target);
      }
    }
  }

  function isTargetStale(target: string, since: number): boolean {
    for (const [invalidated, at] of targetInvalidations) {
      if (
        at >= since &&
        (target.includes(invalidated) || invalidated.includes(target))
      ) {
        return true;
      }
    }
    return false;
  }

  // Actors reach this layer as either a handle or a DID, and invalidations carry
  // the DID, so profile keys are readable both ways and pruned by either.
  const keys = {
    feed: (
      readGen: number,
      feed: string,
      options: {
        cursor?: string;
        language?: string;
        limit: number;
        includePins?: boolean;
        since?: string;
      }
    ) =>
      `${scope}:v${readGen}:feed:${createHash("sha256")
        .update(
          JSON.stringify([
            feed,
            options.cursor ?? "",
            options.language ?? "",
            options.limit,
            options.includePins,
            options.since,
          ])
        )
        .digest("hex")
        .slice(0, 32)}`,
    posts: (readGen: number, uris: string[]) =>
      `${scope}:v${readGen}:posts:${createHash("sha256")
        .update([...uris].toSorted().join(","))
        .digest("hex")
        .slice(0, 32)}`,
    profile: (readGen: number, actor: string) =>
      `${scope}:v${readGen}:profile:${encodeURIComponent(actor)}`,
    suggestedFeeds: (
      readGen: number,
      options: { query?: string; cursor?: string; limit?: number }
    ) =>
      `${scope}:v${readGen}:suggested:${createHash("sha256")
        .update(
          JSON.stringify([
            options.query ?? "",
            options.cursor ?? "",
            options.limit ?? 0,
          ])
        )
        .digest("hex")
        .slice(0, 32)}`,
    thread: (readGen: number, uri: string, depth: number) =>
      `${scope}:v${readGen}:thread:${createHash("sha256")
        .update(`${uri}:${depth}`)
        .digest("hex")
        .slice(0, 32)}`,
    visibility: (readGen: number, did: string) =>
      `${scope}:v${readGen}:visibility:${encodeURIComponent(did)}`,
  };

  const forget = async (targets: string[]) => {
    if (typeof store.del !== "function" || targets.length === 0) {
      return;
    }
    try {
      await store.del(
        ...new Set([
          ...targets.map((target) => keys.visibility(generation, target)),
          ...targets.map((target) => keys.profile(generation, target)),
        ])
      );
    } catch {
      // Deletion is best effort; the timestamp check and TTL still bound staleness.
    }
  };

  const originalInvalidate =
    typeof client.invalidate === "function"
      ? client.invalidate.bind(client)
      : undefined;

  const invalidate = (target?: string) => {
    pending.clear();
    if (!target) {
      // A global invalidation moves every reader to a fresh namespace.
      generation += 1;
      targetInvalidations.clear();
      originalInvalidate?.(target);
      return;
    }
    // Targeted invalidations must not bump the generation. Doing so orphaned the
    // whole shared namespace on every followed-account event, which defeated the
    // cross-replica cache exactly when feeds needed it most.
    targetInvalidations.set(target, Date.now());
    pruneInvalidations();
    void forget([target]);
    originalInvalidate?.(target);
  };

  client.invalidate = invalidate;

  async function readThrough<Value>(options: {
    key: () => string;
    decode: (value: unknown) => Value | null;
    load: () => Promise<Value>;
    retain?: (value: Value) => boolean;
    // Targets known before the read: invalidations since the read started make
    // the freshly loaded value untrustworthy and keep it out of Redis.
    targets: string[];
    // Targets that only become known from the response, such as a profile's DID.
    targetsOf?: (value: Value) => string[];
    ttlSeconds: number;
  }): Promise<Value> {
    const readGen = generation;
    const startedAt = Date.now();
    const key = options.key();
    try {
      const cached = await store.get(key);
      if (cached) {
        const entry: unknown = JSON.parse(cached);
        const value = isEnvelope(entry) ? options.decode(entry.value) : null;
        if (value !== null && isEnvelope(entry)) {
          // Check both the requested target and any target the value itself
          // reveals, so a handle-keyed profile still expires on its DID event.
          const targets = [
            ...options.targets,
            ...(options.targetsOf?.(value) ?? []),
          ];
          if (!targets.some((target) => isTargetStale(target, entry.at))) {
            return value;
          }
        }
      }
    } catch {
      // Redis errors must never prevent a downstream read.
    }
    const existing = pending.get(key);
    if (existing) {
      return (await existing) as Value;
    }
    const work = (async () => {
      const value = await options.load();
      const targets = [
        ...options.targets,
        ...(options.targetsOf?.(value) ?? []),
      ];
      const fresh =
        generation === readGen &&
        !targets.some((target) => isTargetStale(target, startedAt)) &&
        (options.retain?.(value) ?? true);
      if (fresh) {
        try {
          await store.set(
            key,
            JSON.stringify({ at: startedAt, value }),
            "EX",
            options.ttlSeconds
          );
        } catch {
          // A failed cache write does not fail the read.
        }
      }
      return value;
    })();
    pending.set(key, work);
    try {
      return await work;
    } finally {
      if (pending.get(key) === work) {
        pending.delete(key);
      }
    }
  }

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "invalidate") {
        return invalidate;
      }

      if (prop === "allowsRecommendations") {
        return async (did: string) =>
          await readThrough<boolean>({
            decode: (value) => {
              if (typeof value === "boolean") {
                return value;
              }
              // Tolerate the earlier `{ allowed }` shape during a rolling deploy.
              if (isRecord(value) && typeof value.allowed === "boolean") {
                return value.allowed;
              }
              return null;
            },
            key: () => keys.visibility(generation, did),
            load: () => target.allowsRecommendations(did),
            targets: [did],
            ttlSeconds: visibilityTtlSeconds,
          });
      }

      if (prop === "getPostThread") {
        return async (uri: string, depth = 3) =>
          await readThrough<
            Awaited<ReturnType<BlueskyClient["getPostThread"]>>
          >({
            decode: (value) =>
              isRecord(value)
                ? (value as unknown as Awaited<
                    ReturnType<BlueskyClient["getPostThread"]>
                  >)
                : null,
            key: () => keys.thread(generation, uri, depth),
            load: () => target.getPostThread(uri, depth),
            targets: [uri],
            ttlSeconds: threadTtlSeconds,
          });
      }

      if (prop === "getProfile") {
        return async (actor: string) => {
          const readGen = generation;
          const value = await readThrough<
            Awaited<ReturnType<BlueskyClient["getProfile"]>>
          >({
            decode: (cached) =>
              isRecord(cached)
                ? (cached as unknown as Awaited<
                    ReturnType<BlueskyClient["getProfile"]>
                  >)
                : null,
            key: () => keys.profile(readGen, actor),
            load: () => target.getProfile(actor),
            // A handle-keyed entry must still be pruned when its DID changes.
            targets: [actor],
            targetsOf: (profile) => (profile.id ? [profile.id] : []),
            ttlSeconds: profileTtlSeconds,
          });
          return value;
        };
      }

      if (prop === "getPosts") {
        return async (uris: string[]) =>
          await readThrough<Awaited<ReturnType<BlueskyClient["getPosts"]>>>({
            decode: (value) =>
              Array.isArray(value)
                ? (value as Awaited<ReturnType<BlueskyClient["getPosts"]>>)
                : null,
            key: () => keys.posts(generation, uris),
            load: () => target.getPosts(uris),
            retain: (value) => value.length > 0,
            targets: uris,
            ttlSeconds: postsTtlSeconds,
          });
      }

      if (prop === "getFeed") {
        return async (
          feed: string,
          options: {
            cursor?: string;
            includePins?: boolean;
            language?: string;
            limit?: number;
            since?: string;
          } = {}
        ) => {
          const readGen = generation;
          return await readThrough<
            Awaited<ReturnType<BlueskyClient["getFeed"]>>
          >({
            decode: (value) =>
              isRecord(value) && Array.isArray(value.items)
                ? (value as unknown as Awaited<
                    ReturnType<BlueskyClient["getFeed"]>
                  >)
                : null,
            key: () =>
              keys.feed(readGen, feed, {
                cursor: options.cursor,
                includePins: options.includePins,
                language: options.language,
                limit: options.limit ?? 20,
                since: options.since,
              }),
            load: () => target.getFeed(feed, options),
            retain: (value) => value.items.length > 0,
            targets: [feed],
            targetsOf: (page) =>
              page.items.flatMap((post) => [post.id, post.author.id]),
            ttlSeconds: options.cursor ? cursorFeedTtlSeconds : feedTtlSeconds,
          });
        };
      }

      if (prop === "searchPosts") {
        return (
          ...[query, sort, options = {}]: Parameters<
            BlueskyClient["searchPosts"]
          >
        ) => {
          const readGen = generation;
          return readThrough<Awaited<ReturnType<BlueskyClient["searchPosts"]>>>(
            {
              decode: (value) =>
                isRecord(value) && Array.isArray(value.items)
                  ? (value as unknown as Awaited<
                      ReturnType<BlueskyClient["searchPosts"]>
                    >)
                  : null,
              key: () =>
                keys.feed(readGen, `search:${sort}:${query}`, {
                  ...options,
                  limit: options.limit ?? 20,
                }),
              load: () => target.searchPosts(query, sort, options),
              retain: (value) => value.items.length > 0,
              targets: [],
              targetsOf: (page) =>
                page.items.flatMap((post) => [post.id, post.author.id]),
              ttlSeconds: options.cursor
                ? cursorFeedTtlSeconds
                : feedTtlSeconds,
            }
          );
        };
      }

      if (prop === "getAuthorFeed") {
        return (
          ...[actor, tab = "posts", options = {}]: Parameters<
            BlueskyClient["getAuthorFeed"]
          >
        ) => {
          const readGen = generation;
          return readThrough<
            Awaited<ReturnType<BlueskyClient["getAuthorFeed"]>>
          >({
            decode: (value) =>
              isRecord(value) && Array.isArray(value.items)
                ? (value as unknown as Awaited<
                    ReturnType<BlueskyClient["getAuthorFeed"]>
                  >)
                : null,
            key: () =>
              keys.feed(readGen, `author:${actor}:${tab}`, {
                ...options,
                limit: options.limit ?? 20,
              }),
            load: () => target.getAuthorFeed(actor, tab, options),
            retain: (value) => value.items.length > 0,
            targets: [actor],
            targetsOf: (page) =>
              page.items.flatMap((post) => [post.id, post.author.id]),
            ttlSeconds: options.cursor ? cursorFeedTtlSeconds : feedTtlSeconds,
          });
        };
      }

      if (prop === "getSuggestedFeeds") {
        return async (
          options: { query?: string; cursor?: string; limit?: number } = {}
        ) => {
          const readGen = generation;
          return await readThrough<
            Awaited<ReturnType<BlueskyClient["getSuggestedFeeds"]>>
          >({
            decode: (value) =>
              isRecord(value) && Array.isArray(value.items)
                ? (value as unknown as Awaited<
                    ReturnType<BlueskyClient["getSuggestedFeeds"]>
                  >)
                : null,
            key: () => keys.suggestedFeeds(readGen, options),
            load: () => target.getSuggestedFeeds(options),
            retain: (value) => value.items.length > 0,
            targets: [],
            ttlSeconds: suggestedFeedsTtlSeconds,
          });
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}
