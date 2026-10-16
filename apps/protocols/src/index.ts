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
  const client = new BlueskyClient({ observe: createProtocolObserver(logger) });
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
  const app = createProtocolsApp({
    client,
    health: () => health,
    logger,
    token: config.token,
  });
  try {
    app.listen({ hostname: config.hostname, port: config.port });
    if (config.jetstreamEnabled && config.redisUrl) {
      const [
        { default: Redis },
        { RedisCheckpointStore },
        { runJetstreamWorker },
      ] = await Promise.all([
        import("ioredis"),
        import("./checkpoints"),
        import("./worker"),
      ]);
      const redis = new Redis(config.redisUrl, {
        commandTimeout: 3000,
        connectTimeout: 5000,
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
      });
      redis.on("error", () => {
        logger.warn(
          { event: "redis.error" },
          "Protocols Redis connection failed"
        );
      });
      closeRedis = async () => {
        try {
          await redis.quit();
        } finally {
          redis.disconnect();
        }
      };
      await redis.connect();
      worker = runJetstreamWorker({
        health,
        invalidate: () => {
          client.invalidate();
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
