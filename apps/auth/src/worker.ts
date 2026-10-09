// MUST stay the first import. See the note in server.ts: tsyringe (reached via
// the passkey stack) throws at module-eval time without Reflect.getMetadata,
// and the compiled binary evaluates the bundle graph before the entry body.
import "reflect-metadata";
import type { Worker } from "bullmq";

import { loadRootEnv } from "./env";
import {
  readMessageSearchWorkerFeatures,
  readMessageSearchWorkerRole,
  sweepMessageSearchWork,
} from "./worker/message-search-sweep";
import {
  checkWorkerHealth,
  clearWorkerHealth,
  workerHealthPath,
  writeWorkerHealth,
} from "./worker/worker-health";
import {
  attachWorkerFailureReporting,
  createWorkerPulse,
  createWorkerShutdown,
  messageWorkerErrorFields,
  runMessageSearchJob,
} from "./worker/worker-lifecycle";

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

if (import.meta.main && process.argv.includes("--health-check")) {
  // The probe must never initialize telemetry, queues, environment files or database clients.
  const service =
    process.env.MESSAGE_SEARCH_WORKER_ONLY === "1"
      ? "message-search-worker"
      : "worker";
  process.exit(
    (await checkWorkerHealth(workerHealthPath(service), service)) ? 0 : 1
  );
}

if (import.meta.main) {
  loadRootEnv();
  const messageSearchWorkerRole = readMessageSearchWorkerRole({
    MESSAGE_SEARCH_WORKER_ENABLED: process.env.MESSAGE_SEARCH_WORKER_ENABLED,
    MESSAGE_SEARCH_WORKER_ONLY: process.env.MESSAGE_SEARCH_WORKER_ONLY,
  });
  const messageSearchFeatures = readMessageSearchWorkerFeatures({
    MESSAGE_SEARCH_BACKFILL_ENABLED:
      process.env.MESSAGE_SEARCH_BACKFILL_ENABLED,
    MESSAGE_SEARCH_COUNT_ENABLED: process.env.MESSAGE_SEARCH_COUNT_ENABLED,
  });

  const workerServiceName = messageSearchWorkerRole.only
    ? "message-search-worker"
    : "worker";
  const { initTelemetry, createLogger } = await import("@asm/logger");
  const telemetry = initTelemetry({
    serviceName: workerServiceName,
    version: "1.0.0",
  });
  const logger = createLogger({ serviceName: workerServiceName });
  const { createMessageSearchWorkerMetricSink } =
    await import("./worker/message-search-metrics");
  const messageSearchMetrics = createMessageSearchWorkerMetricSink();

  const {
    ensureStreamGroups,
    enqueueMessageSearchCount,
    enqueueMessageSearchBackfill,
    enqueueMessageSearchBackfillOutbox,
    enqueueMessageSearchOutbox,
    enqueueMessageUnreadCounter,
    expireStaleMessageSearchCounts,
    listRunnableMessageSearchCounts,
    listRunnableMessageSearchBackfills,
    listRunnableMessageUnreadCounters,
    registerMaintenanceSchedulers,
    createBullConnection,
    NOTIFICATIONS_QUEUE,
    MESSAGE_UNREAD_COUNTER_QUEUE,
  } = await import("@asm/db");
  const { Worker: QueueWorker } = await import("bullmq");
  type QueueWorkerType = Worker;
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
  const {
    clearMessageSearchKeyCache,
    processMessageSearchBackfill,
    processMessageSearchOutbox,
  } = await import("./worker/message-search-index");
  const { processMessageSearchCount } =
    await import("./worker/message-search-count");
  const {
    closeMessageSearchPool,
    closePrisma,
    prisma,
    reconcileMessageUnreadCounter,
  } = await import("@asm/db");

  const workers: QueueWorkerType[] = [];
  let viewLoopPromise: Promise<void> | undefined;
  let shareLoopPromise: Promise<void> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let messageSearchSweepTimer: ReturnType<typeof setInterval> | undefined;
  let running = true;
  const healthPath = workerHealthPath(workerServiceName);
  let heartbeatPulse: ReturnType<typeof createWorkerPulse> | undefined;
  let sweepPulse: ReturnType<typeof createWorkerPulse> | undefined;
  const registerQueueWorker = <T extends Worker>(worker: T): T => {
    attachWorkerFailureReporting(worker, (fields, message) =>
      logger.error(fields, message)
    );
    // Register immediately so startup failures also participate in shutdown.
    workers.push(worker);
    return worker;
  };

  const start = async () => {
    if (!messageSearchWorkerRole.only) {
      await ensureStreamGroups();
      await registerMaintenanceSchedulers();
    }

    if (!messageSearchWorkerRole.only) {
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
              {
                error,
                stack: error instanceof Error ? error.stack : undefined,
              },
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
              {
                error,
                stack: error instanceof Error ? error.stack : undefined,
              },
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
    }

    const connection = createBullConnection();

    const sweepMessageSearchOutbox = async () => {
      if (!running) {
        return;
      }
      await sweepMessageSearchWork(messageSearchFeatures, {
        enqueueBackfill: enqueueMessageSearchBackfill,
        enqueueBackfillOutbox: enqueueMessageSearchBackfillOutbox,
        enqueueCount: enqueueMessageSearchCount,
        enqueueLiveOutbox: enqueueMessageSearchOutbox,
        enqueueUnreadCounter: (task) =>
          enqueueMessageUnreadCounter(task.conversationId, task.userId),
        expireStaleCounts: expireStaleMessageSearchCounts,
        listPendingOutbox: async (limit, includeBackfill) => {
          const baseQuery = prisma.orm.public.MessageSearchOutbox.select(
            "id",
            "kind"
          ).where({ completedAt: null });
          const pendingQuery = includeBackfill
            ? baseQuery
            : baseQuery.where((row) => row.kind.notIn(["backfill"]));
          return await pendingQuery
            .orderBy((row) => row.createdAt.asc())
            .limit(limit)
            .all();
        },
        listRunnableBackfills: listRunnableMessageSearchBackfills,
        listRunnableCounts: listRunnableMessageSearchCounts,
        listRunnableUnreadCounters: listRunnableMessageUnreadCounters,
      });
    };

    if (messageSearchWorkerRole.enabled) {
      registerQueueWorker(
        new QueueWorker(
          "message-search-live",
          (job) =>
            runMessageSearchJob(() =>
              processMessageSearchOutbox(
                job.data.outboxId,
                logger,
                messageSearchMetrics
              )
            ),
          { concurrency: 2, connection }
        )
      );
      if (messageSearchFeatures.backfill) {
        registerQueueWorker(
          new QueueWorker(
            "message-search-backfill",
            (job) =>
              runMessageSearchJob(async () => {
                const result = await processMessageSearchBackfill(
                  job.data.conversationId,
                  logger,
                  messageSearchMetrics
                );
                if (result.nextCursorMessageId) {
                  await enqueueMessageSearchBackfill(
                    job.data.conversationId,
                    result.nextCursorMessageId
                  );
                }
              }),
            { concurrency: 1, connection }
          )
        );
      }
      if (messageSearchFeatures.counts) {
        registerQueueWorker(
          new QueueWorker(
            "message-search-count",
            (job) =>
              runMessageSearchJob(() =>
                processMessageSearchCount(
                  job.data.requestId,
                  logger,
                  messageSearchMetrics
                )
              ),
            { concurrency: 1, connection }
          )
        );
      }
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- the pulse owns asynchronous failure reporting
      sweepPulse = createWorkerPulse(sweepMessageSearchOutbox, (error) => {
        logger.error(
          messageWorkerErrorFields(error),
          "message search outbox sweep failed"
        );
      });
    }

    if (!messageSearchWorkerRole.only) {
      registerQueueWorker(
        new QueueWorker(
          MESSAGE_UNREAD_COUNTER_QUEUE,
          async (job) => {
            const conversationId = job.data?.conversationId;
            const userId = job.data?.userId;
            if (
              typeof conversationId !== "string" ||
              conversationId.length === 0 ||
              typeof userId !== "string" ||
              userId.length === 0
            ) {
              throw new Error("Invalid message unread counter job");
            }
            await reconcileMessageUnreadCounter({ conversationId, userId });
          },
          { concurrency: 1, connection }
        )
      );
      registerQueueWorker(
        new QueueWorker(
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
        )
      );

      const notificationWorker = registerQueueWorker(
        new QueueWorker(
          NOTIFICATIONS_QUEUE,
          async (job) => {
            if (job.name === "notification-created") {
              return await processNotificationCreated(job.data, logger);
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
        )
      );

      // The "media" queue is consumed by apps/media-processing since the
      // pipeline worker split; auth no longer touches media jobs.

      registerQueueWorker(
        new QueueWorker(
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
        )
      );

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
    }

    await Promise.all(workers.map((worker) => worker.waitUntilReady()));
    if (!running) {
      return;
    }
    heartbeatPulse = createWorkerPulse(
      async () => {
        if (!running) {
          return;
        }
        // Check each process-owned queue connection; a different replica cannot mask an outage.
        const connectionsReady = await Promise.all(
          workers.map(async (worker) => {
            const backend = worker.getBackend();
            const client = await backend.client;
            const blockingClient = await backend.blockingClient;
            return (
              worker.isRunning() &&
              client.status === "ready" &&
              blockingClient?.status === "ready"
            );
          })
        );
        if (connectionsReady.some((ready) => !ready)) {
          await clearWorkerHealth(healthPath);
          return;
        }
        const { redis } = await import("@asm/db");
        const heartbeatValue = String(Date.now());
        const heartbeats: Promise<unknown>[] = [];
        if (!messageSearchWorkerRole.only) {
          heartbeats.push(
            redis.set("worker:heartbeat", heartbeatValue, "EX", 30)
          );
        }
        if (messageSearchWorkerRole.enabled) {
          heartbeats.push(
            redis.set(
              "worker:message-search:heartbeat",
              heartbeatValue,
              "EX",
              30
            )
          );
        }
        await Promise.all(heartbeats);
        if (running) {
          await writeWorkerHealth(healthPath, workerServiceName);
        }
      },
      // eslint-disable-next-line promise/prefer-await-to-callbacks -- asynchronous pulse error observer
      (error) => {
        logger.error(
          messageWorkerErrorFields(error),
          "worker heartbeat failed"
        );
      }
    );
    await heartbeatPulse.run();
    if (!running) {
      return;
    }
    heartbeatTimer = setInterval(() => {
      void heartbeatPulse?.run();
    }, 10_000);
    if (sweepPulse) {
      void sweepPulse.run();
      messageSearchSweepTimer = setInterval(() => {
        void sweepPulse?.run();
      }, 10_000);
    }

    logger.info(
      {
        backfillEnabled: messageSearchFeatures.backfill,
        countsEnabled: messageSearchFeatures.counts,
        messageSearchWorkerEnabled: messageSearchWorkerRole.enabled,
        messageSearchWorkerOnly: messageSearchWorkerRole.only,
      },
      "message search workers configured"
    );
    logger.info("worker started");
  };

  const shutdown = createWorkerShutdown({
    drain: async () => {
      await clearWorkerHealth(healthPath);
      await Promise.all([
        ...workers.map((worker) => worker.close()),
        heartbeatPulse?.dispose(),
        sweepPulse?.dispose(),
        viewLoopPromise,
        shareLoopPromise,
      ]);
      // An in-flight heartbeat may finish during draining; remove its last write as well.
      await clearWorkerHealth(healthPath);
      clearMessageSearchKeyCache();
      await Promise.all([
        closeMessageSearchPool(),
        closePrisma(),
        telemetry.shutdown(),
      ]);
    },
    stop: () => {
      running = false;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (messageSearchSweepTimer) {
        clearInterval(messageSearchSweepTimer);
      }
    },
    timeoutMs: readWorkerInteger("WORKER_SHUTDOWN_TIMEOUT_MS", 30_000, 120_000),
  });

  let exitRequested = false;
  const requestShutdown = async (signal: string, failed = false) => {
    if (exitRequested) {
      return;
    }
    exitRequested = true;
    logger.info({ signal }, "shutting down worker");
    try {
      const outcome = await shutdown();
      if (outcome === "timed-out") {
        logger.warn(
          "worker shutdown deadline reached; durable work will be retried"
        );
      }
      process.exit(failed || outcome === "timed-out" ? 1 : 0);
    } catch (error) {
      logger.error(messageWorkerErrorFields(error), "worker shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => {
    void requestShutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void requestShutdown("SIGTERM");
  });

  try {
    await clearWorkerHealth(healthPath);
    await start();
  } catch (error) {
    logger.error(messageWorkerErrorFields(error), "worker startup failed");
    await requestShutdown("startup", true);
  }
}
