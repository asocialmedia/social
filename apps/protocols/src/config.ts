import { jetstreamEndpoints } from "@asm/protocols/jetstream";
import type { JetstreamEndpoint } from "@asm/protocols/jetstream";

import { readWorkerNodes } from "./read-worker-config";
import type { ReadWorkerNode } from "./read-worker-config";

export interface ProtocolsConfig {
  mode: "coordinator" | "read-worker";
  ingestionQueueEnabled: boolean;
  workers: ReadWorkerNode[];
  workerToken?: string;
  workerId: string;
  workerConcurrency: number;
  workerTimeoutMs: number;
  searchConcurrency: number;
  asmUrl?: string;
  hostname: string;
  port: number;
  token?: string;
  redisUrl?: string;
  jetstreamEnabled: boolean;
  dids: string[];
  endpoint: JetstreamEndpoint;
}

export function readConfig(
  env: Record<string, string | undefined>
): ProtocolsConfig {
  const mode = env.PROTOCOLS_MODE ?? "coordinator";
  if (mode !== "coordinator" && mode !== "read-worker") {
    throw new Error("PROTOCOLS_MODE must be coordinator or read-worker");
  }
  const workers = readWorkerNodes(env.PROTOCOLS_READ_WORKERS);
  const queueEnabled = env.PROTOCOLS_INGESTION_QUEUE_ENABLED ?? "false";
  if (
    !["true", "false"].includes(queueEnabled) ||
    (queueEnabled === "true" && !env.REDIS_URL)
  ) {
    throw new Error(
      "PROTOCOLS_INGESTION_QUEUE_ENABLED must be true or false and requires REDIS_URL when enabled"
    );
  }
  const workerToken = env.PROTOCOLS_WORKER_TOKEN;
  if (
    workerToken !== undefined &&
    !/^[A-Za-z0-9_-]{32,256}$/.test(workerToken)
  ) {
    throw new Error(
      "PROTOCOLS_WORKER_TOKEN must contain 32–256 URL-safe characters"
    );
  }
  const workerId = env.PROTOCOLS_WORKER_ID ?? "worker";
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(workerId) || workerId === "local") {
    throw new Error(
      "PROTOCOLS_WORKER_ID must be a short node identifier other than local"
    );
  }
  const workerConcurrency = Number(env.PROTOCOLS_WORKER_CONCURRENCY ?? "8");
  const workerTimeoutMs = Number(env.PROTOCOLS_WORKER_TIMEOUT_MS ?? "1200");
  if (
    !Number.isInteger(workerConcurrency) ||
    workerConcurrency < 1 ||
    workerConcurrency > 32 ||
    !Number.isInteger(workerTimeoutMs) ||
    workerTimeoutMs < 250 ||
    workerTimeoutMs > 2000
  ) {
    throw new Error(
      "Worker concurrency must be 1–32 and timeout must be 250–2000ms"
    );
  }
  if (
    mode === "read-worker" &&
    (!workerToken ||
      workers.length ||
      env.PROTOCOLS_JETSTREAM_ENABLED === "true")
  ) {
    throw new Error(
      "Read-worker mode requires a dedicated token and no Jetstream or downstream workers"
    );
  }
  const port = Number(env.PROTOCOLS_PORT ?? "3012");
  const searchConcurrency = Number(env.PROTOCOLS_SEARCH_CONCURRENCY ?? "48");
  if (
    !Number.isInteger(searchConcurrency) ||
    searchConcurrency < 1 ||
    searchConcurrency > 64
  ) {
    throw new Error(
      "PROTOCOLS_SEARCH_CONCURRENCY must be an integer between 1 and 64"
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PROTOCOLS_PORT must be a valid port");
  }
  const token = env.PROTOCOLS_INTERNAL_TOKEN;
  if (
    env.NODE_ENV === "production" &&
    token === "asm_protocols_development_only_replace_in_production"
  ) {
    throw new Error("Production requires a unique PROTOCOLS_INTERNAL_TOKEN");
  }
  if (
    token !== undefined &&
    (token.length < 32 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token))
  ) {
    throw new Error(
      "PROTOCOLS_INTERNAL_TOKEN must contain 32–256 URL-safe characters"
    );
  }
  const enabled = env.PROTOCOLS_JETSTREAM_ENABLED ?? "false";
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("PROTOCOLS_JETSTREAM_ENABLED must be true or false");
  }
  const dids = [
    ...new Set(
      (env.PROTOCOLS_BLUESKY_DIDS ?? "")
        .split(",")
        .map((did) => did.trim())
        .filter(Boolean)
    ),
  ].toSorted();
  if (
    dids.length > 1000 ||
    dids.some((did) => !/^did:(?:plc|web):[A-Za-z0-9._:%-]{1,2000}$/.test(did))
  ) {
    throw new Error(
      "PROTOCOLS_BLUESKY_DIDS must be a bounded list of valid DIDs"
    );
  }
  const endpoint = jetstreamEndpoints.find(
    (candidate) =>
      candidate === (env.PROTOCOLS_JETSTREAM_ENDPOINT ?? jetstreamEndpoints[0])
  );
  if (!endpoint) {
    throw new Error(
      "PROTOCOLS_JETSTREAM_ENDPOINT must be a supported public endpoint"
    );
  }
  const redisUrl = env.REDIS_URL;
  if (
    mode === "coordinator" &&
    env.NODE_ENV === "production" &&
    token &&
    !redisUrl
  ) {
    throw new Error(
      "Production discovery requires REDIS_URL for shared continuations"
    );
  }
  const asmUrl =
    env.PROTOCOLS_ASM_URL ??
    env.NEXT_PUBLIC_URL ??
    (env.NODE_ENV === "development" ? "http://localhost:3000" : undefined);
  if (asmUrl) {
    const parsed = new URL(asmUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("PROTOCOLS_ASM_URL must be an HTTP origin");
    }
  }
  if (
    enabled === "true" &&
    (!redisUrl || (asmUrl && !token) || (!asmUrl && !dids.length))
  ) {
    throw new Error(
      "Jetstream requires REDIS_URL and either ASM registry credentials or seed DIDs"
    );
  }
  if (redisUrl) {
    let parsed: URL;
    try {
      parsed = new URL(redisUrl);
    } catch {
      throw new Error("REDIS_URL must be a Redis URL");
    }
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      throw new Error("REDIS_URL must be a Redis URL");
    }
  }
  return {
    asmUrl,
    dids,
    endpoint,
    hostname: env.PROTOCOLS_HOST ?? "0.0.0.0",
    ingestionQueueEnabled: queueEnabled === "true",
    jetstreamEnabled: enabled === "true",
    mode,
    port,
    redisUrl,
    searchConcurrency,
    token,
    workerConcurrency,
    workerId,
    workerTimeoutMs,
    workerToken,
    workers,
  };
}
