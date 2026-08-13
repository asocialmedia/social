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
  const {
    processPostDeleted,
    processNotificationCreated,
    processNotificationDeleted,
    processMediaCleanup,
    processInactiveUsersSweep,
    processHnRefresh,
    processExpiredTokens,
  } = await import("./worker/jobs");

  const workers: QueueWorkerType[] = [];
  let viewLoopPromise: Promise<void> | undefined;
  let shareLoopPromise: Promise<void> | undefined;
  let running = true;

  const start = async () => {
    await ensureStreamGroups();
    await registerMaintenanceSchedulers();

    // Stream consumers (blocking loops, one per stream).
    const runViewLoop = consumeViewStream.bind(
      null,
      `view-worker-${process.pid}`
    );
    const runShareLoop = consumeShareStream.bind(
      null,
      `share-worker-${process.pid}`
    );

    const runViewLoopWithRecovery = async () => {
      while (running) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: blocking stream consumer reads sequentially
          await runViewLoop();
        } catch (error) {
          logger.error(
            { error, stack: error instanceof Error ? error.stack : undefined },
            "view stream consumer failed"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    };

    const runShareLoopWithRecovery = async () => {
      while (running) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: blocking stream consumer reads sequentially
          await runShareLoop();
        } catch (error) {
          logger.error(
            { error, stack: error instanceof Error ? error.stack : undefined },
            "share stream consumer failed"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
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
          case "post-deleted":
            return processPostDeleted(job.data);
          case "notification-created":
            return processNotificationCreated(job.data);
          case "notification-deleted":
            return processNotificationDeleted(job.data);
          default:
            throw new Error(`Unknown content event: ${job.name}`);
        }
      },
      { connection }
    );

    const mediaWorker = new QueueWorker(
      "media",
      (job) => {
        if (job.name === "media-cleanup") {
          return processMediaCleanup(job.data);
        }
        throw new Error(`Unknown media job: ${job.name}`);
      },
      { connection, concurrency: 4 }
    );

    const maintenanceWorker = new QueueWorker(
      "maintenance",
      (job) => {
        switch (job.name) {
          case "hn-refresh":
            return processHnRefresh();
          case "expired-tokens":
            return processExpiredTokens();
          case "inactive-users":
            return processInactiveUsersSweep();
          default:
            throw new Error(`Unknown maintenance job: ${job.name}`);
        }
      },
      { connection }
    );

    workers.push(contentWorker, mediaWorker, maintenanceWorker);

    for (const worker of workers) {
      worker.on("failed", (job, error) => {
        logger.error({ job: job?.name, error }, "job failed");
      });
    }

    logger.info("worker started");
  };

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down worker");
    running = false;
    await Promise.all([
      ...workers.map((worker) => worker.close()),
      viewLoopPromise,
      shareLoopPromise,
    ]);
    await telemetry.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error: unknown) => {
      logger.error({ error }, "shutdown failed");
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error: unknown) => {
      logger.error({ error }, "shutdown failed");
      process.exit(1);
    });
  });

  await start();
}
