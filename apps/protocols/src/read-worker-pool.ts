// Each read makes at most two sequential attempts within the caller's existing deadline.
// oxlint-disable no-await-in-loop
import {
  abortable,
  readJsonBounded,
  retryAfterMs,
} from "@asm/protocols/discovery";
import { context, metrics, propagation } from "@opentelemetry/api";

import type { ProtocolLogger } from "./observability";
import type { ReadWorkerNode } from "./read-worker-config";
import { publicReadTarget } from "./read-worker-policy";

type PublicFetch = (url: string, init: RequestInit) => Promise<Response>;

export function createReadWorkerPool(options: {
  nodes: ReadWorkerNode[];
  logger: ProtocolLogger;
  fetch?: PublicFetch;
  now?: () => number;
  timeoutMs?: number;
}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const nodes = [
    {
      active: 0,
      blocked: new Map<string, number>(),
      id: "local",
      token: "",
      url: "",
    },
    ...options.nodes.map((node) => ({
      ...node,
      active: 0,
      blocked: new Map<string, number>(),
    })),
  ];
  const meter = metrics.getMeter("asm-protocols");
  const requests = meter.createCounter("asm.protocols.worker.requests");
  const duration = meter.createHistogram("asm.protocols.worker.duration", {
    unit: "ms",
  });
  let next = 0;
  const read: PublicFetch = async (raw, init) => {
    const target = publicReadTarget(raw);
    if (
      !target ||
      (init.method && init.method !== "GET") ||
      init.body ||
      new Headers(init.headers).has("authorization")
    ) {
      throw new Error("Only unauthenticated public reads may use read workers");
    }
    const attempted = new Set<string>();
    let pauseMs = 1000;
    let lastStatus = 503;
    for (let attempt = 0; attempt < Math.min(2, nodes.length); attempt += 1) {
      init.signal?.throwIfAborted();
      const ordered = [...nodes.slice(next), ...nodes.slice(0, next)];
      const node = ordered.find(
        (candidate) =>
          !attempted.has(candidate.id) &&
          candidate.active < (candidate.url ? 8 : 256) &&
          (candidate.blocked.get(target.origin) ?? 0) <= now()
      );
      if (!node) {
        break;
      }
      next = (nodes.indexOf(node) + 1) % nodes.length;
      attempted.add(node.id);
      node.active += 1;
      const startedAt = now();
      const signal = AbortSignal.any([
        ...(init.signal ? [init.signal] : []),
        AbortSignal.timeout(node.url ? (options.timeoutMs ?? 1200) : 2500),
      ]);
      const attributes = {
        node: node.id,
        operation: target.pathname.slice(6),
        upstream: target.hostname,
      };
      try {
        const headers = new Headers({ accept: "application/json" });
        let url = raw;
        if (node.url) {
          url = `${node.url}/v1/worker/read?${new URLSearchParams({ url: raw })}`;
          headers.set("authorization", `Bearer ${node.token}`);
          propagation.inject(context.active(), headers, {
            set: (carrier, key, value) => carrier.set(key, value),
          });
        }
        const response = await abortable(
          fetcher(url, {
            cache: "no-store",
            headers,
            method: "GET",
            redirect: "error",
            signal,
          }),
          signal
        );
        const trusted =
          !node.url || response.headers.get("x-asm-read-worker") === "1";
        lastStatus = trusted ? response.status : 503;
        requests.add(1, { ...attributes, status: lastStatus });
        if (
          !trusted ||
          response.status === 429 ||
          response.status === 408 ||
          response.status >= 500 ||
          (node.url && response.status === 401)
        ) {
          pauseMs =
            response.status === 429
              ? (retryAfterMs(response.headers.get("retry-after"), now()) ??
                30_000)
              : 10_000;
          node.blocked.set(target.origin, now() + pauseMs);
          await response.body?.cancel();
          options.logger.warn(
            {
              ...attributes,
              event: "worker.cooldown",
              retryAfterMs: pauseMs,
              status: lastStatus,
            },
            "Protocol read worker paused; trying available capacity"
          );
          continue;
        }
        const body = await readJsonBounded(response, 2 * 1024 * 1024, signal);
        return Response.json(body, { status: response.status });
      } catch {
        init.signal?.throwIfAborted();
        node.blocked.set(target.origin, now() + 10_000);
        requests.add(1, { ...attributes, status: 0 });
        options.logger.warn(
          { ...attributes, event: "worker.unavailable" },
          "Protocol read worker unavailable; trying available capacity"
        );
      } finally {
        node.active -= 1;
        duration.record(now() - startedAt, attributes);
      }
    }
    const remaining = nodes
      .map((node) => (node.blocked.get(target.origin) ?? 0) - now())
      .filter((value) => value > 0);
    if (remaining.length) {
      pauseMs = Math.min(...remaining);
    }
    return Response.json(
      { error: "ReadCapacityUnavailable" },
      {
        headers: {
          "retry-after": String(Math.max(1, Math.ceil(pauseMs / 1000))),
        },
        status: lastStatus === 429 ? 429 : 503,
      }
    );
  };
  return {
    fetch: read,
    status: () =>
      nodes.map((node) => ({
        active: node.active,
        cooldowns: Object.fromEntries(node.blocked),
        id: node.id,
      })),
  };
}
