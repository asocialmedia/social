import { loadRootEnv } from "./env";

if (import.meta.main) {
  loadRootEnv();

  const { initTelemetry, createLogger } = await import("@asm/logger");
  const telemetry = initTelemetry({ serviceName: "worker", version: "1.0.0" });
  const logger = createLogger({ serviceName: "worker" });

  const {
    ensureStreamGroups,
    registerMaintenanceSchedulers,
    createBullConnection,
  } = await import("@asm/db");
  const { Worker: QueueWorker } = await import("bullmq");
  type QueueWorkerType = InstanceType<typeof QueueWorker>;
  const { consumeViewStream } = await import("./worker/view-flush");
  const { consumeShareStream } = await import("./worker/share-flush");
  const { flushTrendingScores } = await import("./worker/trending-score-flush");
  const {
    processPostDeleted,
    processNotificationCreated,
    processNotificationDeleted,
    processMediaCleanup,
    processInactiveUsersSweep,
    processHnRefresh,
    processExpiredTokens,
    processShitposterCheck,
  } = await import("./worker/jobs");

  const workers: QueueWorkerType[] = [];
  let viewLoopPromise: Promise<void> | undefined;
  let shareLoopPromise: Promise<void> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let running = true;

  const start = async () => {
    await ensureStreamGroups();
    await registerMaintenanceSchedulers();

    // Heartbeat written to Redis so the web /api/health endpoint can report
    // whether the worker process is alive.
    const HEARTBEAT_KEY = "worker:heartbeat";
    const HEARTBEAT_TTL = 30;
    const heartbeat = async () => {
      if (!running) {
        return;
      }
      try {
        const { redis } = await import("@asm/db");
        await redis.set(HEARTBEAT_KEY, String(Date.now()), "EX", HEARTBEAT_TTL);
      } catch (error) {
        logger.error({ error }, "worker heartbeat failed");
      }
    };
    await heartbeat();
    heartbeatTimer = setInterval(heartbeat, 10_000);

    // Stream consumers (blocking loops, one per stream).
    const runViewLoop = consumeViewStream.bind(
      null,
      `view-worker-${process.pid}`,
      logger
    );
    const runShareLoop = consumeShareStream.bind(
      null,
      `share-worker-${process.pid}`,
      logger
    );

    const runViewLoopWithRecovery = async () => {
      // eslint-disable-next-line no-unmodified-loop-condition -- running is flipped false by shutdown()
      while (running) {
        try {
          // eslint-disable-next-line no-await-in-loop -- blocking stream consumer reads sequentially
          await runViewLoop();
        } catch (error) {
          logger.error(
            { error, stack: error instanceof Error ? error.stack : undefined },
            "view stream consumer failed"
          );
          // eslint-disable-next-line no-await-in-loop -- retry backoff must delay before the next read
          await Bun.sleep(1000);
        }
      }
    };

    const runShareLoopWithRecovery = async () => {
      // eslint-disable-next-line no-unmodified-loop-condition -- running is flipped false by shutdown()
      while (running) {
        try {
          // eslint-disable-next-line no-await-in-loop -- blocking stream consumer reads sequentially
          await runShareLoop();
        } catch (error) {
          logger.error(
            { error, stack: error instanceof Error ? error.stack : undefined },
            "share stream consumer failed"
          );
          // eslint-disable-next-line no-await-in-loop -- retry backoff must delay before the next read
          await Bun.sleep(1000);
        }
      }
    };

    // Stream consumers run as blocking loops. They exit when `running` flips
    // false in shutdown, so we keep the promises and await them on close.
    viewLoopPromise = runViewLoopWithRecovery();
    shareLoopPromise = runShareLoopWithRecovery();

    const connection = createBullConnection();

    const contentWorker = new QueueWorker(
      "content-events",
      (job) => {
        switch (job.name) {
          case "post-deleted": {
            return processPostDeleted(job.data, logger);
          }
          case "notification-created": {
            return processNotificationCreated(job.data);
          }
          case "notification-deleted": {
            return processNotificationDeleted(job.data);
          }
          case "shitposter-check": {
            return processShitposterCheck(job.data, logger);
          }
          default: {
            throw new Error(`Unknown content event: ${job.name}`);
          }
        }
      },
      { connection }
    );

    const mediaWorker = new QueueWorker(
      "media",
      (job) => {
        if (job.name === "media-cleanup") {
          return processMediaCleanup(job.data, logger);
        }
        throw new Error(`Unknown media job: ${job.name}`);
      },
      { concurrency: 4, connection }
    );

    const maintenanceWorker = new QueueWorker(
      "maintenance",
      async (job) => {
        switch (job.name) {
          case "hn-refresh": {
            return processHnRefresh();
          }
          case "expired-tokens": {
            return processExpiredTokens(logger);
          }
          case "inactive-users": {
            return processInactiveUsersSweep(logger);
          }
          case "trending-scores": {
            const startedAtMs = Date.now();
            try {
              return await flushTrendingScores(logger);
            } finally {
              logger.info(
                { durationMs: Date.now() - startedAtMs },
                "trending-scores job finished"
              );
            }
          }
          default: {
            throw new Error(`Unknown maintenance job: ${job.name}`);
          }
        }
      },
      { connection }
    );

    workers.push(contentWorker, mediaWorker, maintenanceWorker);

    for (const worker of workers) {
      worker.on("failed", (job, error) => {
        logger.error({ error, job: job?.name }, "job failed");
      });
    }

    logger.info("worker started");
  };

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down worker");
    running = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    await Promise.all([
      ...workers.map((worker) => worker.close()),
      viewLoopPromise,
      shareLoopPromise,
    ]);
    await telemetry.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void (async () => {
      try {
        await shutdown("SIGINT");
      } catch (error: unknown) {
        logger.error({ error }, "shutdown failed");
        process.exit(1);
      }
    })();
  });
  process.on("SIGTERM", () => {
    void (async () => {
      try {
        await shutdown("SIGTERM");
      } catch (error: unknown) {
        logger.error({ error }, "shutdown failed");
        process.exit(1);
      }
    })();
  });

  await start();
}
