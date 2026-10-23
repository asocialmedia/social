// oxlint-disable promise/prefer-await-to-then
import type RedisConnection from "ioredis";

import { version } from "../package.json";
import type { ProtocolIngestionQueue } from "./ingestion-queue";
import { loadProtocolsEnvironment } from "./load-env";

export async function startProtocols() {
  loadProtocolsEnvironment();
  process.env.OTEL_SERVICE_NAME ??= "asm-protocols";
  process.env.OPENOBSERVE_LOG_STREAM ??= "asm_protocols_logs";
  process.env.OPENOBSERVE_METRIC_STREAM ??= "asm_protocols_metrics";
  process.env.OPENOBSERVE_TRACE_STREAM ??= "asm_protocols_traces";
  const { createLogger, initTelemetry } = await import("@asm/logger");
  const telemetry = initTelemetry({
    serviceName: "asm-protocols",
    version,
  });
  const logger = createLogger({ serviceName: process.env.OTEL_SERVICE_NAME });
  const { readConfig } = await import("./config");
  let config: ReturnType<typeof readConfig>;
  try {
    config = readConfig(process.env);
  } catch (error) {
    logger.error(
      {
        reason:
          error instanceof Error ? error.message : "Invalid configuration",
      },
      "Protocols configuration failed"
    );
    await telemetry.shutdown();
    throw error;
  }
  if (config.mode === "read-worker") {
    const { startReadWorker } = await import("./read-worker");
    try {
      return await startReadWorker(config, logger, telemetry);
    } catch (error) {
      await telemetry.shutdown();
      throw error;
    }
  }
  const { createReadWorkerPool } = await import("./read-worker-pool");
  const pool = config.workers.length
    ? createReadWorkerPool({
        logger,
        nodes: config.workers,
        timeoutMs: config.workerTimeoutMs,
      })
    : undefined;
  const [
    { createProtocolsApp },
    { createProtocolObserver },
    { BlueskyClient },
  ] = await Promise.all([
    import("./app"),
    import("./observability"),
    import("@asm/protocols/bluesky"),
  ]);
  const client = new BlueskyClient({
    fetch: pool?.fetch,
    maxConcurrentRequests: 48,
    maxRetries: 0,
    observe: createProtocolObserver(logger),
    timeoutMs: 2500,
  });
  const explicitClient = new BlueskyClient({
    allowExplicitMedia: true,
    fetch: pool?.fetch,
    maxConcurrentRequests: 24,
    maxRetries: 0,
    observe: createProtocolObserver(logger),
    timeoutMs: 2500,
  });
  const searchClient = new BlueskyClient({
    fetch: pool?.fetch,
    maxConcurrentRequests: config.searchConcurrency,
    maxRetries: 0,
    observe: createProtocolObserver(logger),
    timeoutMs: 2500,
  });
  const explicitSearchClient = new BlueskyClient({
    allowExplicitMedia: true,
    fetch: pool?.fetch,
    maxConcurrentRequests: config.searchConcurrency,
    maxRetries: 0,
    observe: createProtocolObserver(logger),
    timeoutMs: 2500,
  });
  const health = {
    connected: false,
    draining: false,
    jetstreamEnabled: config.jetstreamEnabled,
    lastEventAt: null as number | null,
    leaseHeld: false,
    processedEvents: 0,
  };
  const discoveryHealth = { ...health };
  const abort = new AbortController();
  let worker = Promise.resolve();
  let closeRedis: (() => Promise<void>) | undefined;
  const { BlueskyDiscovery } = await import("./discovery");
  const { MemoryDiscoveryStore, RedisDiscoveryStore } =
    await import("./discovery-store");
  let redis: RedisConnection | undefined;
  if (config.redisUrl) {
    const { default: Redis } = await import("ioredis");
    redis = new Redis(config.redisUrl, {
      commandTimeout: 2000,
      connectTimeout: 3000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
    });
    let lastErrorAt = 0;
    redis.on("error", () => {
      if (Date.now() - lastErrorAt > 30_000) {
        lastErrorAt = Date.now();
        logger.warn(
          { event: "redis.unavailable" },
          "Protocols storage unavailable; reconnecting"
        );
      }
    });
    redis.on("ready", () =>
      logger.info({ event: "redis.ready" }, "Protocols storage ready")
    );
    const connection = redis;
    closeRedis = async () => {
      try {
        if (connection.status === "ready") {
          const { abortable } = await import("@asm/protocols/discovery");
          await abortable(connection.quit(), AbortSignal.timeout(2500));
        }
      } finally {
        connection.disconnect();
      }
    };
    // oxlint-disable-next-line promise/prefer-await-to-then -- startup must serve health while Redis reconnects.
    void redis.connect().catch(() => {
      // Ioredis reconnects in the background; readiness stays unavailable until it recovers.
    });
  }
  const { createCachedBlueskyClient } = await import("./cache-client");
  const { DiscoveryInventory, RedisInventoryStore } =
    await import("./discovery-inventory");
  const { createDiscoveryIngestion, hydrateDiscoveryBatch } =
    await import("./discovery-ingestion");
  const { createBlueskySearch } = await import("./search");
  const {
    createRedisReadStore,
    FEED_EVENTS_CHANNEL,
    PROTOCOL_INVALIDATIONS_CHANNEL,
  } = await import("@asm/protocols/discovery");
  const search = createBlueskySearch({
    client: searchClient,
    concurrency: config.searchConcurrency,
    explicitClient: explicitSearchClient,
    store: redis ? createRedisReadStore(redis) : undefined,
  });
  const effectiveClient = redis
    ? createCachedBlueskyClient(client, redis)
    : client;
  const effectiveExplicitClient = redis
    ? createCachedBlueskyClient(
        explicitClient,
        redis,
        "asm:protocols:cache:explicit-v2"
      )
    : explicitClient;
  const discovery = new BlueskyDiscovery(effectiveClient, undefined, {
    store: redis ? new RedisDiscoveryStore(redis) : new MemoryDiscoveryStore(),
  });
  const inventoryStore = redis ? new RedisInventoryStore(redis) : undefined;
  let ingestionQueue: ProtocolIngestionQueue | undefined;
  if (
    config.ingestionQueueEnabled &&
    redis &&
    config.redisUrl &&
    inventoryStore
  ) {
    const { createIngestionQueue } = await import("./ingestion-queue");
    const connection = redis;
    ingestionQueue = createIngestionQueue({
      allowedNodes: config.workers.map((node) => node.id),
      coordinator: true,
      hydrate: (ids, startedAt) =>
        hydrateDiscoveryBatch(
          {
            client: effectiveClient,
            publish: () =>
              connection.publish(
                FEED_EVENTS_CHANNEL,
                JSON.stringify({ source: "bluesky" })
              ),
            store: inventoryStore,
          },
          ids,
          startedAt
        ),
      logger,
      node: "local",
      redis,
      redisUrl: config.redisUrl,
    });
  }
  const inventory =
    inventoryStore && redis
      ? new DiscoveryInventory(
          inventoryStore,
          new RedisDiscoveryStore(redis, {
            scope: "asm:protocols:{inventory-cursors:v2}",
          }),
          async (mode, cursor, locale, topics, content) => {
            const startedAt = Date.now();
            return remember(
              await discovery.read(mode, cursor, locale, topics, content),
              startedAt
            );
          }
        )
      : undefined;
  const ingestion =
    inventoryStore && redis
      ? createDiscoveryIngestion({
          client: effectiveClient,
          dispatch: ingestionQueue?.enqueue,
          publish: () =>
            redis?.publish(
              FEED_EVENTS_CHANNEL,
              JSON.stringify({ source: "bluesky" })
            ),
          publishInvalidation: (event) =>
            redis?.publish(
              PROTOCOL_INVALIDATIONS_CHANNEL,
              JSON.stringify({
                did: event.did,
                kind: event.kind,
                ...(event.kind === "commit" &&
                event.commit.collection === "app.bsky.feed.post"
                  ? {
                      uri: `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`,
                    }
                  : {}),
              })
            ),
          store: inventoryStore,
        })
      : undefined;
  const remember = async (
    page: Awaited<ReturnType<typeof discovery.read>>,
    startedAt: number
  ) => {
    await inventoryStore?.put(page.items, startedAt).catch(() => {
      // A cache outage does not discard a successful upstream result.
    });
    return page;
  };
  const discover: NonNullable<
    Parameters<typeof createProtocolsApp>[0]["discover"]
  > = async (mode, cursor, locale = "", topics = [], content = "all") => {
    ingestion?.watch(topics);
    const local = await inventory
      ?.read(mode, cursor, locale, topics, content)
      .catch((error: unknown) => {
        if (cursor) {
          throw error;
        }
        return null;
      });
    if (local) {
      return local;
    }
    const startedAt = Date.now();
    return remember(
      await discovery.read(mode, cursor, locale, topics, content),
      startedAt
    );
  };
  const explicitDiscovery = new BlueskyDiscovery(
    effectiveExplicitClient,
    undefined,
    {
      allowExplicit: true,
      store: redis
        ? new RedisDiscoveryStore(redis, {
            scope: "asm:protocols:{discovery:explicit:v1}",
          })
        : new MemoryDiscoveryStore(),
    }
  );
  const explicitInventoryStore = redis
    ? new RedisInventoryStore(redis, "asm:protocols:{inventory:explicit:v2}")
    : undefined;
  const readExplicitSource = async (
    mode: Parameters<typeof explicitDiscovery.read>[0],
    cursor?: string,
    locale = "",
    topics: string[] = [],
    content: Parameters<typeof explicitDiscovery.read>[4] = "all"
  ) => {
    const startedAt = Date.now();
    const page = await explicitDiscovery.read(
      mode,
      cursor,
      locale,
      topics,
      content
    );
    await explicitInventoryStore?.put(page.items, startedAt).catch(() => null);
    return page;
  };
  const explicitInventory =
    explicitInventoryStore && inventoryStore && redis
      ? new DiscoveryInventory(
          {
            invalidate: (target) => explicitInventoryStore.invalidate(target),
            put: (posts, startedAt) =>
              explicitInventoryStore.put(posts, startedAt),
            read: async () => {
              const pages = await Promise.all([
                inventoryStore.read(),
                explicitInventoryStore.read(),
              ]);
              return [
                ...new Map(
                  pages.flat().map((post) => [post.id, post])
                ).values(),
              ];
            },
          },
          new RedisDiscoveryStore(redis, {
            scope: "asm:protocols:{inventory-cursors:explicit:v2}",
          }),
          readExplicitSource,
          true
        )
      : undefined;
  const explicitDiscover: NonNullable<
    Parameters<typeof createProtocolsApp>[0]["discover"]
  > = async (mode, cursor, locale = "", topics = [], content = "all") => {
    ingestion?.watch(topics);
    const local = await explicitInventory?.read(
      mode,
      cursor,
      locale,
      topics,
      content
    );
    if (local) {
      // Safe cached candidates can render immediately while the opt-in pool replenishes separately.
      if (!cursor) {
        void readExplicitSource(mode, undefined, locale, topics, content).catch(
          () => null
        );
      }
      return local;
    }
    return readExplicitSource(mode, cursor, locale, topics, content);
  };
  let stopLive: (() => void) | undefined;
  if (redis) {
    const { createDiscoveryLive, discoveryWatchSchema } =
      await import("./discovery-live");
    const { DISCOVERY_WATCH_CHANNEL } =
      await import("@asm/protocols/discovery");
    const publisher = redis;
    const subscriber = redis.duplicate({ lazyConnect: true });
    subscriber.on("error", () => {
      // Existing health and storage logging owns Redis availability reporting.
    });
    const live = createDiscoveryLive({
      publish: (channel, message) => publisher.publish(channel, message),
      read: async ({ mode, locale, topics, content, explicit }, refresh) => {
        ingestion?.watch(topics);
        const selectedDiscovery = explicit ? explicitDiscovery : discovery;
        const selectedInventory = explicit
          ? explicitInventoryStore
          : inventoryStore;
        const retain = async (
          page: Awaited<ReturnType<typeof discovery.read>>,
          startedAt: number
        ) => {
          await selectedInventory?.put(page.items, startedAt).catch(() => null);
          return page;
        };
        const startedAt = Date.now();
        const page = await (refresh
          ? selectedDiscovery.refreshHead(mode, locale, topics, content)
          : selectedDiscovery.read(mode, undefined, locale, topics, content));
        await retain(page, startedAt);
        // Replenish continuation inventory off the viewer's request path.
        if (page.cursor) {
          void (async () => {
            let cursor: string | null = page.cursor;
            for (
              let index = 0;
              cursor && index < 2 && !abort.signal.aborted;
              index += 1
            ) {
              const began = Date.now();
              // oxlint-disable-next-line no-await-in-loop -- continuation pages must advance in order.
              const next = await selectedDiscovery.read(
                mode,
                cursor,
                locale,
                topics,
                content
              );
              // oxlint-disable-next-line no-await-in-loop -- retain each validated page before continuing.
              await retain(next, began);
              ({ cursor } = next);
            }
          })().catch(() => null);
        }
        return page;
      },
      store: new RedisDiscoveryStore(redis),
    });
    subscriber.on("message", (channel, raw) => {
      if (channel === PROTOCOL_INVALIDATIONS_CHANNEL) {
        try {
          const event = JSON.parse(raw) as {
            did?: string;
            uri?: string;
            operation?: string;
          };
          if (event.did) {
            client.invalidate(event.uri ?? event.did);
            explicitClient.invalidate(event.uri ?? event.did);
            void inventoryStore
              ?.invalidate(event.uri ?? event.did)
              .catch(() => null);
            void explicitInventoryStore
              ?.invalidate(event.uri ?? event.did)
              .catch(() => null);
          }
        } catch {
          // Malformed notifications cannot invalidate the whole shared cache.
        }
        live.invalidate();
      } else {
        try {
          const watch: unknown = JSON.parse(raw);
          live.watch(watch);
          const parsed = discoveryWatchSchema.safeParse(watch);
          if (parsed.success && parsed.data.content === "all") {
            live.watch({ ...parsed.data, content: "video" });
            if (parsed.data.mode === "personalized") {
              // Mix fresh arrivals into the same temporary inventory without delaying the ranked reader.
              live.watch({ ...parsed.data, mode: "latest" });
            }
          }
        } catch {
          // Invalid watch hints carry no work.
        }
      }
    });
    const subscribe = () => {
      void subscriber
        .subscribe(DISCOVERY_WATCH_CHANNEL, PROTOCOL_INVALIDATIONS_CHANNEL)
        .catch(() => {
          // Reconnect resubscribes on ready.
        });
    };
    subscriber.on("ready", subscribe);
    void subscriber.connect().catch(() => {
      // The subscriber reconnects in the background.
    });
    const timer = setInterval(() => {
      if (publisher.status !== "ready") {
        return;
      }
      void live.tick().catch(() => {
        // A failed reconciliation is retried by the next tick.
      });
      void ingestion?.tick();
    }, 1000);
    timer.unref();
    stopLive = () => {
      clearInterval(timer);
      live.stop();
      subscriber.disconnect();
    };
  }
  const app = createProtocolsApp({
    client: effectiveClient,
    discover,
    explicitClient: effectiveExplicitClient,
    explicitDiscover,
    health: () => ({
      ...health,
      discovery: config.jetstreamEnabled
        ? {
            connected: discoveryHealth.connected,
            lastEventAt: discoveryHealth.lastEventAt,
            leaseHeld: discoveryHealth.leaseHeld,
            processedEvents: discoveryHealth.processedEvents,
            queued: ingestion?.pendingCount ?? 0,
          }
        : undefined,
      ingestion: ingestionQueue?.status(),
      storageReady: redis ? redis.status === "ready" : true,
      workers: pool?.status(),
    }),
    logger,
    search,
    token: config.token,
  });
  try {
    app.listen({ hostname: config.hostname, port: config.port });
    if (redis && (config.jetstreamEnabled || (config.asmUrl && config.token))) {
      const connection = redis;
      worker = (async () => {
        const { waitForStorageReady } = await import("./storage-ready");
        if (!(await waitForStorageReady(connection, abort.signal))) {
          return;
        }
        const { runFollowTracking } = await import("./follow-tracking");
        const following = runFollowTracking({
          client,
          config,
          health,
          invalidate: (event) => {
            client.invalidate(event?.did);
            explicitClient.invalidate(event?.did);
          },
          logger,
          redis: connection,
          signal: abort.signal,
        });
        const publicDiscovery =
          config.jetstreamEnabled && ingestion
            ? (async () => {
                const { RedisCheckpointStore } = await import("./checkpoints");
                const { runJetstreamWorker } = await import("./worker");
                const streamOptions = {
                  dids: [],
                  endpoint: config.endpoint,
                  publicDiscovery: true,
                };
                await runJetstreamWorker({
                  health: discoveryHealth,
                  invalidate: () => {
                    // Discovery ingestion publishes only hydrated, policy-checked updates.
                  },
                  logger,
                  processEvent: ingestion.event,
                  signal: abort.signal,
                  store: new RedisCheckpointStore(connection, {
                    ...streamOptions,
                    publishInvalidations: false,
                  }),
                  streamOptions,
                });
              })()
            : Promise.resolve();
        await Promise.all([following, publicDiscovery]);
      })();
    }
  } catch (error) {
    abort.abort();
    await stopLive?.();
    await ingestionQueue?.close();
    client.close();
    explicitClient.close();
    search.close();
    searchClient.close();
    explicitSearchClient.close();
    await app.stop(true);
    await closeRedis?.().catch(() => {
      // The original startup failure takes precedence over Redis cleanup.
    });
    await telemetry.shutdown();
    throw error;
  }
  logger.info(
    {
      event: "protocols.started",
      healthUrl: `http://${config.hostname}:${config.port}/health`,
      jetstreamEnabled: config.jetstreamEnabled,
      port: config.port,
      readWorkers: config.workers.map((node) => node.id),
      readinessUrl: `http://${config.hostname}:${config.port}/ready`,
      readsEnabled: Boolean(config.token),
      trackedAccounts: config.dids.length,
      url: `http://${config.hostname}:${config.port}`,
      version,
    },
    "Protocols service started"
  );
  if (!config.token) {
    logger.warn(
      { event: "protocols.reads_disabled" },
      "Set PROTOCOLS_INTERNAL_TOKEN to enable internal reads; use the dev script for local defaults"
    );
  }
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      health.draining = true;
      abort.abort();
      await stopLive?.();
      await ingestionQueue?.close();
      client.close();
      explicitClient.close();
      search.close();
      searchClient.close();
      explicitSearchClient.close();
      await Promise.race([worker, Bun.sleep(3000)]).catch(() => null);
      await app.stop(true);
      try {
        await closeRedis?.();
      } catch {
        logger.warn(
          { event: "redis.shutdown_failed" },
          "Redis shutdown did not finish cleanly"
        );
      }
      logger.info({ event: "protocols.stopped" }, "Protocols service stopped");
      logger.flush();
      await telemetry.shutdown();
      process.removeListener("SIGTERM", shutdown);
      process.removeListener("SIGINT", shutdown);
    })();
    return stopping;
  };
  const shutdown = async () => {
    const isProduction = process.env.NODE_ENV === "production";
    const shutdownTimeoutMs = isProduction ? 8000 : 2500;
    const forceExitTimer = setTimeout(() => {
      logger.warn(
        { event: "protocols.shutdown_timeout" },
        "Protocols force exiting after timeout"
      );
      process.exit(0);
    }, shutdownTimeoutMs + 500);
    forceExitTimer.unref();

    try {
      await Promise.race([stop(), Bun.sleep(shutdownTimeoutMs)]);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "protocols shutdown failed");
      process.exit(1);
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return { app, health, stop };
}

if (import.meta.main) {
  try {
    await startProtocols();
  } catch {
    process.exitCode = 1;
  }
}
