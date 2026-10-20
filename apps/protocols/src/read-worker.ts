import { timingSafeEqual } from "node:crypto";

import type { BlueskyClient } from "@asm/protocols/bluesky";
import { Elysia } from "elysia";
import type RedisConnection from "ioredis";

import { version } from "../package.json";
import type { ProtocolsConfig } from "./config";
import type { ProtocolIngestionQueue } from "./ingestion-queue";
import {
  createProtocolObserver,
  observeRequest,
  requestId,
} from "./observability";
import type { ProtocolLogger } from "./observability";
import { publicReadTarget } from "./read-worker-policy";
import { createWorkerReader } from "./worker-reader";

export function createReadWorkerApp(options: {
  token: string;
  id: string;
  concurrency?: number;
  logger: ProtocolLogger;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  background?: () => unknown;
}) {
  const reader = createWorkerReader({
    ...options,
    observe: createProtocolObserver(options.logger),
  });
  const authorized = (request: Request) => {
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${options.token}`);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  };
  const app = new Elysia({
    name: "asm.protocols.read-worker",
    serve: { maxRequestBodySize: 1024 },
  })
    .onError(({ set }) => {
      set.status = 500;
      return { error: "worker_failed" };
    })
    .get("/health", () => ({
      mode: "read-worker",
      service: "protocols",
      status: reader.status().draining ? "draining" : "ok",
      version,
    }))
    .get("/ready", ({ request }) => {
      if (!authorized(request)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json(
        {
          active: reader.status().active,
          id: options.id,
          ingestion: options.background?.(),
          mode: "read-worker",
          version,
        },
        {
          headers: { "cache-control": "no-store", "x-asm-read-worker": "1" },
          status: reader.status().draining ? 503 : 200,
        }
      );
    })
    .get("/v1/worker/read", async ({ request }) => {
      if (!authorized(request)) {
        return Response.json(
          { error: "unauthorized" },
          { headers: { "x-asm-read-worker": "1" }, status: 401 }
        );
      }
      const target = publicReadTarget(
        new URL(request.url).searchParams.get("url") ?? ""
      );
      if (!target) {
        return Response.json(
          { error: "invalid_target" },
          { headers: { "x-asm-read-worker": "1" }, status: 400 }
        );
      }
      return await observeRequest(
        `worker.${target.pathname.slice(6)}`,
        request,
        requestId(request),
        options.logger,
        () => reader.fetch(target.href, { signal: request.signal })
      );
    });
  return { app, drain: reader.drain, fetch: reader.fetch };
}

export async function startReadWorker(
  config: ProtocolsConfig,
  logger: ProtocolLogger & { flush: () => void },
  telemetry: { shutdown: () => Promise<void> }
) {
  if (!config.workerToken) {
    throw new Error("Read worker requires PROTOCOLS_WORKER_TOKEN");
  }
  let ingestion: ProtocolIngestionQueue | undefined;
  let storage: RedisConnection | undefined;
  let hydrationClient: BlueskyClient | undefined;
  const worker = createReadWorkerApp({
    background: () => ingestion?.status(),
    concurrency: config.workerConcurrency,
    id: config.workerId,
    logger,
    token: config.workerToken,
  });
  if (config.ingestionQueueEnabled && config.redisUrl) {
    const { default: Redis } = await import("ioredis");
    const { BlueskyClient } = await import("@asm/protocols/bluesky");
    const { RedisInventoryStore } = await import("./discovery-inventory-store");
    const { createIngestionQueue } = await import("./ingestion-queue");
    const { hydrateDiscoveryBatch } = await import("./discovery-ingestion");
    const { FEED_EVENTS_CHANNEL } = await import("@asm/protocols/discovery");
    storage = new Redis(config.redisUrl, {
      commandTimeout: 2000,
      connectTimeout: 3000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
    });
    let warnedAt = 0;
    storage.on("error", () => {
      if (Date.now() - warnedAt > 30_000) {
        warnedAt = Date.now();
        logger.warn(
          { event: "worker.storage_unavailable", node: config.workerId },
          "Ingestion Redis unavailable; public reads remain available"
        );
      }
    });
    const connection = storage;
    const client = new BlueskyClient({
      // This worker does not own stream invalidations; each batch must read current source state.
      cache: {
        clear: () => {
          // There are no retained source snapshots to clear.
        },
        get: () => null,
        set: () => {
          // Source snapshots must not outlive the batch that fetched them.
        },
      },
      fetch: worker.fetch,
      maxConcurrentRequests: config.workerConcurrency,
      maxRetries: 0,
      observe: createProtocolObserver(logger),
      timeoutMs: 2500,
    });
    hydrationClient = client;
    const store = new RedisInventoryStore(connection);
    ingestion = createIngestionQueue({
      concurrency: 2,
      coordinator: false,
      hydrate: (ids, startedAt) =>
        hydrateDiscoveryBatch(
          {
            client,
            publish: () =>
              connection.publish(
                FEED_EVENTS_CHANNEL,
                JSON.stringify({ source: "bluesky" })
              ),
            store,
          },
          ids,
          startedAt
        ),
      logger,
      node: config.workerId,
      redis: connection,
      redisUrl: config.redisUrl,
    });
  }
  worker.app.listen({ hostname: config.hostname, port: config.port });
  logger.info(
    {
      event: "worker.started",
      mode: config.mode,
      node: config.workerId,
      port: config.port,
      version,
    },
    "Protocol read worker started"
  );
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      worker.drain();
      hydrationClient?.close();
      await ingestion?.close();
      storage?.disconnect();
      await worker.app.stop(true);
      logger.info(
        { event: "worker.stopped", node: config.workerId },
        "Protocol read worker stopped"
      );
      logger.flush();
      await telemetry.shutdown();
      process.removeListener("SIGTERM", shutdown);
      process.removeListener("SIGINT", shutdown);
    })();
    return stopping;
  };
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return { app: worker.app, stop };
}
