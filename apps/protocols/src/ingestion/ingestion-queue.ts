// Queue refreshes and batch processing are sequential to preserve ownership and source invalidation fences.
// oxlint-disable promise/prefer-await-to-then
import { createHash } from "node:crypto";

import { ProtocolError } from "@asm/protocols/contracts";
import { metrics, context, propagation } from "@opentelemetry/api";
import { Queue, Worker, UnrecoverableError, DelayedError } from "bullmq";
import type Redis from "ioredis";
import { z } from "zod";

import { observeRequest } from "../runtime/observability";
import type { ProtocolLogger } from "../runtime/observability";
import {
  HydrationLifetimeExpiredError,
  hydrationLifetimeMs,
  hydrationRetryDelay,
  resolveRefence,
} from "./hydration-retry";

export {
  HydrationLifetimeExpiredError,
  hydrationRetryDelay,
} from "./hydration-retry";

const queueName = "asm-protocols-hydration-v1";
const nodesKey = "asm:protocols:hydration:workers:v1";
export type ProtocolIngestionQueue = ReturnType<typeof createIngestionQueue>;
const batchSchema = z.object({
  ids: z
    .array(
      z
        .string()
        .max(4096)
        .regex(/^at:\/\/did:(?:plc|web):[^/]+\/app\.bsky\.feed\.post\/[^/]+$/)
    )
    .min(1)
    .max(25),
  refencedAt: z.number().int().positive().optional(),
  scheduledAt: z.number().int().positive().optional(),
  startedAt: z.number().int().positive(),
  trace: z
    .object({
      traceparent: z.string().max(512).optional(),
      tracestate: z.string().max(512).optional(),
    })
    .strict()
    .optional(),
});

export type HydrationBatch = z.infer<typeof batchSchema>;

export class HydrationRescheduleError extends Error {
  readonly batch: HydrationBatch;
  constructor(batch: HydrationBatch) {
    super("Hydration scheduling window expired");
    this.name = "HydrationRescheduleError";
    this.batch = batch;
  }
}

export async function runHydrationJob(
  data: unknown,
  hydrate: (ids: string[], startedAt: number) => Promise<number>,
  now = Date.now
): Promise<number> {
  const parsed = batchSchema.safeParse(data);
  if (!parsed.success) {
    throw new UnrecoverableError("Invalid protocol hydration batch");
  }
  const timestamp = now();
  if (
    parsed.data.startedAt > timestamp + 10_000 ||
    (parsed.data.scheduledAt ?? 0) > timestamp + 10_000
  ) {
    throw new UnrecoverableError("Invalid protocol hydration timestamp");
  }
  if (parsed.data.startedAt < timestamp - hydrationLifetimeMs) {
    throw new HydrationLifetimeExpiredError();
  }
  if ((parsed.data.scheduledAt ?? parsed.data.startedAt) < timestamp - 60_000) {
    // Refresh scheduling without changing the source timestamp used by inventory invalidation fences.
    throw new HydrationRescheduleError({
      ...parsed.data,
      scheduledAt: timestamp,
    });
  }
  return await hydrate(parsed.data.ids, parsed.data.startedAt);
}

export function ingestionConnection(url: string) {
  const parsed = new URL(url);
  return {
    connectTimeout: 3000,
    db: Number(parsed.pathname.slice(1) || 0),
    host: parsed.hostname,
    maxRetriesPerRequest: null,
    password: decodeURIComponent(parsed.password) || undefined,
    port: Number(parsed.port || 6379),
    retryStrategy: (attempt: number) => Math.min(attempt * 250, 5000),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    username: decodeURIComponent(parsed.username) || undefined,
  };
}

export function createIngestionQueue(options: {
  redis: Redis;
  redisUrl: string;
  logger: ProtocolLogger;
  node: string;
  coordinator: boolean;
  allowedNodes?: string[] | (() => string[]);
  hydrate: (ids: string[], startedAt: number) => Promise<number>;
  concurrency?: number;
  scope?: string;
  lockDuration?: number;
  stalledInterval?: number;
}) {
  const name = options.scope ?? queueName;
  const controlKey = options.scope ? `${name}:workers` : nodesKey;
  let stopped = false;
  let permitted = options.coordinator;
  let started = false;
  let completed = 0;
  let failed = 0;
  let refreshing: Promise<void> | undefined;
  let lastWarning = 0;
  const warn = () => {
    if (Date.now() - lastWarning > 30_000) {
      lastWarning = Date.now();
      options.logger.warn(
        { event: "ingestion.storage_unavailable", node: options.node },
        "Protocol ingestion storage unavailable; local recovery remains enabled"
      );
    }
  };
  const counter = metrics
    .getMeter("asm-protocols")
    .createCounter("asm.protocols.ingestion.batches");
  const posts = metrics
    .getMeter("asm-protocols")
    .createCounter("asm.protocols.ingestion.posts");
  const queue = new Queue<HydrationBatch>(name, {
    connection: options.redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { delay: 1000, type: "exponential" },
      removeOnComplete: { age: 120, count: 100 },
      removeOnFail: { age: 300, count: 100 },
    },
    streams: { events: { maxLen: 1000 } },
  });
  queue.on("error", warn);
  const worker = new Worker<HydrationBatch, number>(
    name,
    async (job) => {
      const parsed = batchSchema.safeParse(job.data);
      const request = new Request("http://protocols.internal/ingestion", {
        headers: parsed.success ? parsed.data.trace : undefined,
      });
      return await observeRequest(
        "ingestion.hydrate",
        request,
        job.id ?? crypto.randomUUID(),
        options.logger,
        async () => {
          try {
            return await runHydrationJob(job.data, options.hydrate);
          } catch (error) {
            if (error instanceof HydrationLifetimeExpiredError) {
              const at = Date.now();
              const decision = resolveRefence(job.data.refencedAt, at);
              if (decision.terminal) {
                // The outage outlasted the re-fence budget: drop loudly
                // instead of occupying the bounded queue with an immortal
                // batch. attemptsMade is unaffected, so this stays terminal.
                throw new UnrecoverableError(
                  "Protocol hydration batch expired after extended outage; dropping batch"
                );
              }
              // The batch outwaited its fence during an outage, not because
              // it is poison: re-fence with a current timestamp and defer so
              // the posts still hydrate instead of dropping silently.
              await job.updateData({
                ...job.data,
                refencedAt: decision.refencedAt,
                scheduledAt: at,
                startedAt: at,
              });
              // Only report deferral after durable scheduling succeeds; storage failures remain errors.
              await job.moveToDelayed(at + 1000, job.token);
              options.logger.info(
                {
                  event: "ingestion.deferred",
                  node: options.node,
                  refreshedFence: true,
                  retryAfterMs: 1000,
                },
                "Protocol hydration waiting for read capacity"
              );
              throw new DelayedError();
            }
            const reschedule = error instanceof HydrationRescheduleError;
            const delay = reschedule ? 1000 : hydrationRetryDelay(error);
            if (!delay) {
              // Non-retryable validation and permission failures must not
              // occupy the bounded retry queue or masquerade as internal errors.
              // Cancellations stay retryable: shutdowns and aborted reads must
              // rehydrate on retry instead of dropping the batch.
              if (
                error instanceof ProtocolError &&
                ["invalid_input", "restricted"].includes(error.code)
              ) {
                throw new UnrecoverableError(
                  `Protocol hydration rejected: ${error.code}`
                );
              }
              throw error;
            }
            if (reschedule) {
              await job.updateData(error.batch);
            }
            // Only report deferral after durable scheduling succeeds; storage failures remain errors.
            await job.moveToDelayed(Date.now() + delay, job.token);
            options.logger.info(
              {
                event: "ingestion.deferred",
                node: options.node,
                retryAfterMs: delay,
              },
              "Protocol hydration waiting for read capacity"
            );
            throw new DelayedError();
          }
        },
        { isDeferredError: (error) => error instanceof DelayedError }
      );
    },
    {
      autorun: false,
      concurrency: options.concurrency ?? 1,
      connection: ingestionConnection(options.redisUrl),
      lockDuration: options.lockDuration ?? 15_000,
      maxStalledCount: 1,
      stalledInterval: options.stalledInterval ?? 5000,
    }
  );
  worker.on("error", warn);
  worker.on("completed", (_job, eligible) => {
    completed += 1;
    counter.add(1, { node: options.node, outcome: "completed" });
    posts.add(eligible, { node: options.node });
    if (completed % 50 === 1) {
      options.logger.info(
        { eligible, event: "ingestion.completed", node: options.node },
        "Protocol ingestion batch hydrated and checked"
      );
    }
  });
  worker.on("failed", (job, error) => {
    failed += 1;
    counter.add(1, { node: options.node, outcome: "failed" });
    // Include job identity and cause. Unrecoverable rejections are terminal,
    // and so is an ordinary error once the attempt budget is spent, since
    // BullMQ will not retry it further.
    const maxAttempts = job?.opts?.attempts ?? 3;
    const exhausted = (job?.attemptsMade ?? 0) >= maxAttempts;
    const terminal = error instanceof UnrecoverableError || exhausted;
    const log = terminal ? options.logger.error : options.logger.warn;
    log.call(
      options.logger,
      {
        attemptsMade: job?.attemptsMade,
        errorName: error instanceof Error ? error.name : "unknown",
        event: "ingestion.retry",
        jobId: job?.id,
        node: options.node,
        reason:
          error instanceof Error ? error.message.slice(0, 300) : "unknown",
        terminal,
      },
      terminal
        ? "Protocol hydration terminally rejected; dropping batch"
        : "Protocol hydration failed; bounded queue retry scheduled"
    );
  });
  worker.on("stalled", () =>
    options.logger.warn(
      { event: "ingestion.reclaimed", node: options.node },
      "Protocol ingestion reclaimed an interrupted batch"
    )
  );
  const updateControl = async () => {
    if (stopped) {
      return;
    }
    try {
      if (options.redis.status !== "ready") {
        if (!options.coordinator) {
          permitted = false;
          if (started) {
            await worker.pause();
          }
        }
        return;
      }
      if (options.coordinator) {
        await options.redis.set(
          controlKey,
          JSON.stringify(
            typeof options.allowedNodes === "function"
              ? options.allowedNodes()
              : (options.allowedNodes ?? [])
          ),
          "EX",
          30
        );
      } else {
        const raw = await options.redis.get(controlKey);
        const ids: unknown = raw ? JSON.parse(raw) : [];
        permitted = Array.isArray(ids) && ids.includes(options.node);
      }
      if (stopped) {
        return;
      }
      if (permitted) {
        if (started) {
          await worker.resume();
        } else {
          started = true;
          void worker.run().catch(warn);
        }
      } else if (started) {
        await worker.pause();
      }
    } catch {
      if (!options.coordinator) {
        permitted = false;
        if (started) {
          await worker.pause();
        }
      }
      warn();
    }
  };
  const refresh = () => {
    refreshing ??= updateControl().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };
  const timer = setInterval(() => {
    void refresh();
  }, 5000);
  timer.unref();
  void refresh();
  return {
    async close() {
      stopped = true;
      clearInterval(timer);
      await worker.close(true);
      await queue.close();
    },
    async enqueue(ids: string[], startedAt: number) {
      if (options.redis.status !== "ready") {
        return false;
      }
      const counts = await queue.getJobCounts("wait", "active", "delayed");
      if (Object.values(counts).reduce((sum, count) => sum + count, 0) >= 256) {
        return false;
      }
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      const trace = Object.fromEntries(
        Object.entries(carrier).filter(
          ([key]) => key === "traceparent" || key === "tracestate"
        )
      );
      const data = batchSchema.parse({
        ids,
        scheduledAt: Date.now(),
        startedAt,
        trace,
      });
      const jobId = createHash("sha256")
        .update(JSON.stringify([ids, startedAt]))
        .digest("hex");
      await queue.add("hydrate", data, { jobId });
      return true;
    },
    queue,
    refresh,
    status: () => ({
      completed,
      enabled: true,
      failed,
      node: options.node,
      permitted,
      storageReady: options.redis.status === "ready",
    }),
    worker,
  };
}
