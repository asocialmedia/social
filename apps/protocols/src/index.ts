// oxlint-disable promise/prefer-await-to-then
import type RedisConnection from "ioredis";

import { version } from "../package.json";
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
  const logger = createLogger({ serviceName: "asm-protocols" });
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
    maxConcurrentRequests: 48,
    observe: createProtocolObserver(logger),
    timeoutMs: 10_000,
  });
  const explicitClient = new BlueskyClient({
    allowExplicitMedia: true,
    maxConcurrentRequests: 24,
    observe: createProtocolObserver(logger),
    timeoutMs: 10_000,
  });
  const health = {
    connected: false,
    draining: false,
    jetstreamEnabled: config.jetstreamEnabled,
    lastEventAt: null as number | null,
    leaseHeld: false,
    processedEvents: 0,
  };
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
  const effectiveClient = redis
    ? createCachedBlueskyClient(client, redis)
    : client;
  const discovery = new BlueskyDiscovery(effectiveClient, undefined, {
    store: redis ? new RedisDiscoveryStore(redis) : new MemoryDiscoveryStore(),
  });
  const explicitDiscovery = new BlueskyDiscovery(explicitClient, undefined, {
    store: redis
      ? new RedisDiscoveryStore(redis, {
          scope: "asm:protocols:{discovery:explicit:v1}",
        })
      : new MemoryDiscoveryStore(),
  });
  let stopLive: (() => void) | undefined;
  if (redis) {
    const { createDiscoveryLive } = await import("./discovery-live");
    const { DISCOVERY_WATCH_CHANNEL, PROTOCOL_INVALIDATIONS_CHANNEL } =
      await import("@asm/protocols/discovery");
    const publisher = redis;
    const subscriber = redis.duplicate({ lazyConnect: true });
    subscriber.on("error", () => {
      // Existing health and storage logging owns Redis availability reporting.
    });
    const live = createDiscoveryLive({
      publish: (channel, message) => publisher.publish(channel, message),
      read: ({ mode, locale, topics, content }, refresh) =>
        refresh
          ? discovery.refreshHead(mode, locale, topics, content)
          : discovery.read(mode, undefined, locale, topics, content),
      store: new RedisDiscoveryStore(redis),
    });
    subscriber.on("message", (channel, raw) => {
      if (channel === PROTOCOL_INVALIDATIONS_CHANNEL) {
        client.invalidate();
        explicitClient.invalidate();
        live.invalidate();
      } else {
        try {
          live.watch(JSON.parse(raw));
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
      void live.tick().catch(() => {
        // A failed reconciliation is retried by the next tick.
      });
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
    discover: (mode, cursor, locale, topics, content) =>
      discovery.read(mode, cursor, locale, topics, content),
    explicitClient,
    explicitDiscover: (mode, cursor, locale, topics, content) =>
      explicitDiscovery.read(mode, cursor, locale, topics, content),
    health: () => ({
      ...health,
      storageReady: redis ? redis.status === "ready" : true,
    }),
    logger,
    token: config.token,
  });
  try {
    app.listen({ hostname: config.hostname, port: config.port });
    if (config.jetstreamEnabled && redis) {
      const [{ RedisCheckpointStore }, { runJetstreamWorker }] =
        await Promise.all([import("./checkpoints"), import("./worker")]);
      worker = runJetstreamWorker({
        health,
        invalidate: (event) => {
          client.invalidate(event?.did);
          explicitClient.invalidate(event?.did);
        },
        logger,
        signal: abort.signal,
        store: new RedisCheckpointStore(redis, {
          dids: config.dids,
          endpoint: config.endpoint,
        }),
        streamOptions: { dids: config.dids, endpoint: config.endpoint },
      });
    }
  } catch (error) {
    abort.abort();
    await stopLive?.();
    client.close();
    explicitClient.close();
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
      client.close();
      explicitClient.close();
      await worker;
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
    try {
      await stop();
    } catch {
      process.exitCode = 1;
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
