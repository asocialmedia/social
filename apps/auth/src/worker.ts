// MUST stay the first import. See the note in server.ts: tsyringe (reached via
// the passkey stack) throws at module-eval time without Reflect.getMetadata,
// and the compiled binary evaluates the bundle graph before the entry body.
import "reflect-metadata";
import { loadRootEnv } from "./env";

function readWorkerInteger(
  name: string,
  fallback: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(process.env[name] ?? ""));
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

if (import.meta.main) {
  loadRootEnv();

  const { initTelemetry, createLogger } = await import("@asm/logger");
  const telemetry = initTelemetry({ serviceName: "worker", version: "1.0.0" });
  const logger = createLogger({ serviceName: "worker" });

  const {
    ensureStreamGroups,
    registerMaintenanceSchedulers,
    createBullConnection,
    NOTIFICATIONS_QUEUE,
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
    processInactiveUsersSweep,
    processExpiredUsernameAliases,
    processHnRefresh,
    processExpiredTokens,
    processShitposterCheck,
    processPublishedNotificationCleanup,
    processBadgeSweep,
    processPublishedNotificationsSweep,
  } = await import("./worker/jobs");
  const { healCredentialAccounts } = await import("./worker/account-heal");
  const { processMessagePush } = await import("./worker/message-push");

  const workers: QueueWorkerType[] = [];
  let viewLoopPromise: Promise<void> | undefined;
  let shareLoopPromise: Promise<void> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let running = true;

  const start = async () => {
    await ensureStreamGroups();
    await registerMaintenanceSchedulers();

    // Heal legacy credential-account shapes once per boot so accounts broken by
    // the old divergent reset writer are repaired on deploy rather than after
    // the first hourly sweep. Backgrounded and best-effort: a failure here must
    // never block the workers from starting.
    void (async () => {
      try {
        await healCredentialAccounts(logger);
      } catch (error: unknown) {
        logger.error({ error }, "boot credential-account heal failed");
      }
    })();

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
            return processNotificationCreated(job.data, logger);
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

    const notificationWorker = new QueueWorker(
      NOTIFICATIONS_QUEUE,
      async (job) => {
        if (job.name === "notification-created") {
          return await processNotificationCreated(job.data, logger);
        }
        if (job.name === "message-push") {
          return await processMessagePush(job.data, logger);
        }
        throw new Error(`Unknown notification event: ${job.name}`);
      },
      {
        concurrency: readWorkerInteger(
          "NOTIFICATION_WORKER_CONCURRENCY",
          8,
          32
        ),
        connection,
        limiter: {
          duration: 1000,
          max: readWorkerInteger("NOTIFICATION_WORKER_RATE_MAX", 40, 200),
        },
      }
    );

    // The "media" queue is consumed by apps/media-processing since the
    // pipeline worker split; auth no longer touches media jobs.

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
          case "expired-username-aliases": {
            return processExpiredUsernameAliases(logger);
          }
          case "inactive-users": {
            return processInactiveUsersSweep(logger);
          }
          case "cleanup-published-notification": {
            return processPublishedNotificationCleanup(job.data, logger);
          }
          case "cleanup-published-notifications": {
            return processPublishedNotificationsSweep(logger);
          }
          case "badge-sweep": {
            return processBadgeSweep(logger);
          }
          case "heal-credential-accounts": {
            return healCredentialAccounts(logger);
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

    workers.push(contentWorker, notificationWorker, maintenanceWorker);

    notificationWorker.on("completed", (job) => {
      logger.info(
        {
          attemptsMade: job.attemptsMade,
          durationMs:
            typeof job.processedOn === "number" && job.timestamp
              ? job.processedOn - job.timestamp
              : undefined,
          job: job.name,
        },
        "notification job completed"
      );
    });

    notificationWorker.on("failed", (job, error) => {
      logger.error(
        {
          attemptsMade: job?.attemptsMade,
          error,
          job: job?.name,
        },
        "notification job failed after retries"
      );
    });

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
