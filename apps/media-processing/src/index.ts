// Media pipeline worker entrypoint. Consumes the "media" BullMQ queue:
// security scanning, derivative processing (phase 2), and abandoned-draft
// cleanup. Runs in its own container so ffmpeg/AV failures can never take
// down auth or notification workers.
//
// All app modules are imported dynamically AFTER loadRootEnv(): src/env.ts
// validates at import time and must observe the final environment.

import type { MediaCleanupJobData, MediaScanJobData } from "@asm/media";

import { loadRootEnv } from "./load-env";

if (import.meta.main) {
  loadRootEnv();

  const { initTelemetry, createLogger } = await import("@asm/logger");
  const telemetry = initTelemetry({ serviceName: "media-processing" });
  const mediaLogger = createLogger({ serviceName: "media-processing" });

  type Telemetry = ReturnType<typeof initTelemetry>;

  const { prisma } = await import("@asm/db");
  const { MEDIA_JOB_NAMES } = await import("@asm/media");
  const { Worker } = await import("bullmq");
  const { processMediaScan } = await import("./jobs/scan");
  const { processMedia } = await import("./jobs/process");
  const { processMediaCleanup } = await import("./jobs/cleanup");
  const { processMediaAnalyze } = await import("./jobs/analyze");
  const { workerEnv } = await import("./env");

  let running = true;

  const bullConnection = () => ({
    maxRetriesPerRequest: null,
    url: workerEnv.REDIS_URL,
  });

  const mediaWorker = new Worker(
    "media",
    async (job) => {
      switch (job.name) {
        case MEDIA_JOB_NAMES.scan: {
          return await processMediaScan(job.data as MediaScanJobData);
        }
        case MEDIA_JOB_NAMES.cleanup: {
          return await processMediaCleanup(job.data as MediaCleanupJobData);
        }
        case MEDIA_JOB_NAMES.process: {
          return await processMedia(job.data as { mediaId: string });
        }
        case MEDIA_JOB_NAMES.analyze: {
          return await processMediaAnalyze(job.data as { mediaId: string });
        }
        case MEDIA_JOB_NAMES.deleteCascade: {
          throw new Error(`Job not implemented yet: ${job.name}`);
        }
        default: {
          throw new Error(`Unknown media job: ${job.name}`);
        }
      }
    },
    { concurrency: workerEnv.SCAN_CONCURRENCY, connection: bullConnection() }
  );

  // Terminal failure marking: once BullMQ exhausts attempts, the row must
  // leave SCANNING/PROCESSING so it cannot wedge forever. Retryable rows
  // were already released back to QUARANTINED by the handler.
  mediaWorker.on("failed", async (job, error) => {
    mediaLogger.error(
      {
        error: String(error),
        jobId: job?.id,
        mediaId: job?.data?.mediaId,
        name: job?.name,
      },
      "media job failed"
    );
    const mediaId = job?.data?.mediaId;
    const exhausted =
      job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1);
    if (job?.name === MEDIA_JOB_NAMES.scan && mediaId && exhausted) {
      await prisma.media
        .updateMany({
          data: { failureCode: "scan-failed", status: "FAILED" },
          where: { id: mediaId, status: { in: ["SCANNING", "QUARANTINED"] } },
        })
        .catch((markError: unknown) => {
          mediaLogger.error(
            { error: String(markError) },
            "failed to mark FAILED"
          );
        });
    }
  });

  mediaWorker.on("completed", (job) => {
    mediaLogger.debug({ jobId: job.id, name: job.name }, "media job completed");
  });

  // Minimal liveness surface for container orchestration.
  const healthServer = Bun.serve({
    fetch() {
      return Response.json({
        clamav: workerEnv.CLAMAV_HOST ? "configured" : "disabled",
        status: running ? "ok" : "shutting-down",
      });
    },
    port: workerEnv.HEALTH_PORT,
  });

  const shutdown = async () => {
    if (!running) {
      return;
    }
    running = false;
    mediaLogger.info({}, "media-processing shutting down");
    healthServer.stop(true);
    await Promise.allSettled([mediaWorker.close()]);
    await (telemetry as Telemetry).shutdown().catch(() => null);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  mediaLogger.info(
    {
      clamav: workerEnv.CLAMAV_HOST ?? "disabled",
      healthPort: workerEnv.HEALTH_PORT,
      scanConcurrency: workerEnv.SCAN_CONCURRENCY,
    },
    "media-processing worker ready"
  );
}
