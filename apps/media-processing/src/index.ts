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
  const { registerBackfillSchedulers } = await import("./backfill");

  let running = true;

  const bullConnection = () => ({
    maxRetriesPerRequest: null,
    url: workerEnv.REDIS_URL,
  });

  // Two pools: scan is I/O-bound (ClamAV + hash + strip), process is
  // CPU/ffmpeg-bound. Splitting eliminates head-of-line where a burst of
  // 4-rung HLS encodes blocks scans for minutes.
  const scanWorker = new Worker(
    "media",
    async (job) => {
      switch (job.name) {
        case MEDIA_JOB_NAMES.scan: {
          return await processMediaScan(job.data as MediaScanJobData);
        }
        case MEDIA_JOB_NAMES.cleanup: {
          return await processMediaCleanup(job.data as MediaCleanupJobData);
        }
        case MEDIA_JOB_NAMES.deleteCascade: {
          throw new Error(`Job not implemented yet: ${job.name}`);
        }
        default: {
          throw new Error(`Unknown media job: ${job.name}`);
        }
      }
    },
    {
      concurrency: workerEnv.SCAN_CONCURRENCY,
      connection: bullConnection(),
      // Long enough that a 4-rung HLS post-process sequence on a later
      // job on the *process* worker does not stall the scan queue's lock.
      lockDuration: 30_000,
      stalledInterval: 30_000,
    }
  );

  const processWorker = new Worker(
    "media",
    async (job) => {
      switch (job.name) {
        case MEDIA_JOB_NAMES.process: {
          return await processMedia(job.data as { mediaId: string });
        }
        case MEDIA_JOB_NAMES.analyze: {
          return await processMediaAnalyze(job.data as { mediaId: string });
        }
        default: {
          throw new Error(`Unknown media job: ${job.name}`);
        }
      }
    },
    {
      concurrency: workerEnv.PROCESS_CONCURRENCY,
      connection: bullConnection(),
      // HLS ladder is sequential: 4 rungs * 15 min cap can approach 60 min.
      // Process worker needs a long lock so it isn't considered stalled.
      lockDuration: 5 * 60 * 1000,
      stalledInterval: 30_000,
    }
  );

  // Terminal failure marking: once BullMQ exhausts attempts, the row must
  // leave SCANNING/PROCESSING so it cannot wedge forever. Retryable rows
  // were already released back to QUARANTINED by the handler.
  //
  // Later-stage exhaustion behaves differently on purpose: by the time
  // process/analyze run, the row is READY with verified bytes published -
  // the original is servable and attachable. Flipping such a row to FAILED
  // would take good content offline over a transcode/model hiccup, so the
  // failure is instead recorded on the row (failureCode/detail survives for
  // ops queries) and the derived-heal sweep keeps retrying derivatives.
  const handleFailed = async (job: { id?: string; name?: string; data?: { mediaId?: string }; attemptsMade: number; opts: { attempts?: number } } | undefined, error: unknown) => {
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
    const isPolicyRejection = (error as { name?: string })?.name === "ResourceLimitError";
    const exhausted = isPolicyRejection || (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1));
    if (!mediaId || !exhausted) {
      if (isPolicyRejection) {
        // One-and-done: policy violation, no retry worth doing
        try {
          await (job as unknown as { moveToFailed?: (e: unknown, t: string, f: boolean) => Promise<void> })?.moveToFailed?.(error, "0", true);
        } catch {
          // not in a Worker context — fall through
        }
      }
      return;
    }
    if (job?.name === MEDIA_JOB_NAMES.scan) {
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
      return;
    }
    if (
      job?.name === MEDIA_JOB_NAMES.process ||
      job?.name === MEDIA_JOB_NAMES.analyze
    ) {
      await prisma.media
        .updateMany({
          data: {
            failureCode:
              job.name === MEDIA_JOB_NAMES.process
                ? "encode-failed"
                : "unknown",
            failureDetail: {
              message: String(error),
              stage: job.name,
            },
          },
          // Only rows still actively serving: a REJECTED/FAILED/DELETED row
          // must never resurrect diagnostic fields onto itself.
          where: { id: mediaId, status: "READY" },
        })
        .catch((markError: unknown) => {
          mediaLogger.error(
            { error: String(markError) },
            "failed to record stage failure"
          );
        });
    }
  };

  scanWorker.on("failed", handleFailed);
  processWorker.on("failed", handleFailed);

  // Self-healing backfill watchdog + legacy object GC (daily sweeps).
  const sweepWorker = await registerBackfillSchedulers(bullConnection());

  scanWorker.on("completed", (job) => {
    mediaLogger.debug({ jobId: job.id, name: job.name }, "scan completed");
  });
  processWorker.on("completed", (job) => {
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
    await Promise.allSettled([scanWorker.close(), processWorker.close(), sweepWorker.close()]);
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
      processConcurrency: workerEnv.PROCESS_CONCURRENCY,
    },
    "media-processing worker ready"
  );
}
