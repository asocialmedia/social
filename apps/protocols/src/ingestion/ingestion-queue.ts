// Queue refreshes and batch processing are sequential to preserve ownership and source invalidation fences.
// oxlint-disable promise/prefer-await-to-then
import { createHash } from "node:crypto";

import { metrics, context, propagation } from "@opentelemetry/api";
import { Queue, Worker, UnrecoverableError, DelayedError } from "bullmq";
import type Redis from "ioredis";
import { z } from "zod";

import { observeRequest } from "../runtime/observability";
import type { ProtocolLogger } from "../runtime/observability";
import { hydrationLifetimeMs, hydrationRetryDelay } from "./hydration-retry";

export { hydrationRetryDelay } from "./hydration-retry";

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
    throw new UnrecoverableError("Protocol hydration lifetime expired");
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
  allowedNodes?: string[];
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
      try {
        return await observeRequest(
          "ingestion.hydrate",
          request,
          job.id ?? crypto.randomUUID(),
          options.logger,
          () => runHydrationJob(job.data, options.hydrate)
        );
      } catch (error) {
        const reschedule = error instanceof HydrationRescheduleError;
        const delay = reschedule ? 1000 : hydrationRetryDelay(error);
        if (!delay) {
          throw error;
        }
        if (reschedule) {
          await job.updateData(error.batch);
        }
        // Rescheduling and cooling down do not consume failure attempts; source lifetime still bounds the job.
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
  worker.on("failed", () => {
    failed += 1;
    counter.add(1, { node: options.node, outcome: "failed" });
    options.logger.warn(
      { event: "ingestion.retry", node: options.node },
      "Protocol hydration failed; bounded queue retry scheduled"
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
          JSON.stringify(options.allowedNodes ?? []),
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
