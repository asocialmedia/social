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
import { publicReadHeaders, publicReadTarget } from "./read-worker-policy";

type PublicFetch = (url: string, init: RequestInit) => Promise<Response>;

export function createReadWorkerPool(options: {
  nodes: ReadWorkerNode[];
  logger: ProtocolLogger;
  fetch?: PublicFetch;
  now?: () => number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  localReserveMs?: number;
}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const nodes = [
    {
      active: 0,
      blocked: new Map<string, number>(),
      id: "local",
      operationFailures: new Map<string, { count: number; at: number }>(),
      recovering: new Set<string>(),
      token: "",
      transportFailures: 0,
      url: "",
    },
    ...options.nodes.map((node) => ({
      ...node,
      active: 0,
      blocked: new Map<string, number>(),
      operationFailures: new Map<string, { count: number; at: number }>(),
      recovering: new Set<string>(),
      transportFailures: 0,
    })),
  ];
  const meter = metrics.getMeter("asm-protocols");
  const requests = meter.createCounter("asm.protocols.worker.requests");
  const duration = meter.createHistogram("asm.protocols.worker.duration", {
    unit: "ms",
  });
  const block = (blocked: Map<string, number>, key: string, delay: number) => {
    for (const [entry, until] of blocked) {
      if (until <= now()) {
        blocked.delete(entry);
      }
    }
    if (blocked.size >= 512 && !blocked.has(key)) {
      blocked.delete(blocked.keys().next().value ?? "");
    }
    blocked.set(key, now() + delay);
  };
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
    const deadline = now() + (options.requestTimeoutMs ?? 2500);
    const search = target.pathname === "/xrpc/app.bsky.feed.searchPosts";
    const resource = search
      ? `${target.origin}${target.pathname}:${target.searchParams}`
      : `${target.origin}${target.pathname}:${target.searchParams.get("feed") ?? ""}`;
    const operationKey = `${target.origin}${target.pathname}`;
    let pauseMs = 1000;
    let lastStatus = 503;
    let lastFailure: Response | undefined;
    const available = (candidate: (typeof nodes)[number]) =>
      !attempted.has(candidate.id) &&
      candidate.active < (candidate.url ? 8 : 256) &&
      (candidate.blocked.get(target.origin) ?? 0) <= now() &&
      (candidate.blocked.get(operationKey) ?? 0) <= now() &&
      (candidate.blocked.get(resource) ?? 0) <= now() &&
      !candidate.recovering.has(operationKey);
    for (let attempt = 0; attempt < Math.min(2, nodes.length); attempt += 1) {
      init.signal?.throwIfAborted();
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        break;
      }
      const ordered = [...nodes.slice(next), ...nodes.slice(0, next)];
      const node =
        (attempt > 0
          ? nodes.find((candidate) => !candidate.url && available(candidate))
          : undefined) ?? ordered.find(available);
      if (!node) {
        break;
      }
      // A remote-first read must leave a usable local attempt inside the caller's budget.
      const reserveMs =
        attempt === 0 &&
        node.url &&
        nodes.some((candidate) => !candidate.url && available(candidate))
          ? (options.localReserveMs ?? 1300)
          : 0;
      const attemptTimeoutMs = Math.max(
        1,
        Math.min(
          node.url ? (options.timeoutMs ?? 1800) : remainingMs,
          remainingMs - reserveMs
        )
      );
      next = (nodes.indexOf(node) + 1) % nodes.length;
      attempted.add(node.id);
      node.active += 1;
      if (node.operationFailures.has(operationKey)) {
        node.recovering.add(operationKey);
      }
      const startedAt = now();
      const signal = AbortSignal.any([
        ...(init.signal ? [init.signal] : []),
        AbortSignal.timeout(attemptTimeoutMs),
      ]);
      const attributes = {
        node: node.id,
        operation: target.pathname.slice(6),
        upstream: target.hostname,
      };
      try {
        const headers = publicReadHeaders(init.headers);
        let url = raw;
        if (node.url) {
          url = `${node.url}/v1/worker/read?${new URLSearchParams({ url: raw })}`;
          headers.set("authorization", `Bearer ${node.token}`);
          headers.set("x-asm-worker-envelope", "1");
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
        const suppliedStatus = response.headers.get("x-asm-upstream-status");
        const upstreamStatus =
          node.url &&
          trusted &&
          suppliedStatus &&
          /^[45]\d{2}$/.test(suppliedStatus)
            ? Number(suppliedStatus)
            : response.status;
        const workerAuthFailure = Boolean(
          node.url && trusted && response.status === 401 && !suppliedStatus
        );
        if (trusted) {
          node.transportFailures = 0;
        }
        lastStatus = trusted ? upstreamStatus : 503;
        requests.add(1, { ...attributes, status: lastStatus });
        if (
          !trusted ||
          upstreamStatus === 429 ||
          upstreamStatus === 408 ||
          upstreamStatus >= 500 ||
          (node.url && upstreamStatus === 403) ||
          workerAuthFailure
        ) {
          let defaultPauseMs = 10_000;
          if (upstreamStatus === 403) {
            defaultPauseMs = 300_000;
          } else if (upstreamStatus === 429) {
            defaultPauseMs = 30_000;
          }
          pauseMs =
            retryAfterMs(response.headers.get("retry-after"), now()) ??
            defaultPauseMs;
          let cooldownKey = resource;
          if (upstreamStatus === 429 || workerAuthFailure) {
            cooldownKey = target.origin;
          } else if (upstreamStatus === 403 && !search) {
            cooldownKey = operationKey;
          }
          block(node.blocked, cooldownKey, pauseMs);
          if (trusted) {
            const body = await readJsonBounded(
              response,
              2 * 1024 * 1024,
              signal
            ).catch(() => ({ error: "UpstreamUnavailable" }));
            lastFailure = Response.json(body, {
              headers: { "retry-after": String(Math.ceil(pauseMs / 1000)) },
              status: upstreamStatus,
            });
          } else {
            await response.body?.cancel();
          }
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
        const body = await readJsonBounded(
          response,
          2 * 1024 * 1024,
          signal
        ).catch((error: unknown) => {
          if (response.ok) {
            throw error;
          }
          return { error: "UpstreamRejected" };
        });
        node.operationFailures.delete(operationKey);
        return Response.json(body, { status: upstreamStatus });
      } catch (error) {
        init.signal?.throwIfAborted();
        node.transportFailures += 1;
        for (const [key, failure] of node.operationFailures) {
          if (now() - failure.at > 5 * 60_000) {
            node.operationFailures.delete(key);
          }
        }
        const failures =
          (node.operationFailures.get(operationKey)?.count ?? 0) + 1;
        if (
          node.operationFailures.size >= 512 &&
          !node.operationFailures.has(operationKey)
        ) {
          node.operationFailures.delete(
            node.operationFailures.keys().next().value ?? ""
          );
        }
        node.operationFailures.set(operationKey, {
          at: now(),
          count: failures,
        });
        const operationPauseMs = Math.min(
          120_000,
          10_000 * 2 ** Math.min(failures - 1, 4)
        );
        block(node.blocked, operationKey, operationPauseMs);
        if (node.url && node.transportFailures >= 3) {
          block(node.blocked, target.origin, 30_000);
        }
        requests.add(1, { ...attributes, status: 0 });
        options.logger.warn(
          {
            ...attributes,
            event: "worker.unavailable",
            reason: error instanceof Error ? error.name : "unknown",
            retryAfterMs: operationPauseMs,
          },
          "Protocol read worker unavailable; trying available capacity"
        );
      } finally {
        node.active -= 1;
        node.recovering.delete(operationKey);
        duration.record(now() - startedAt, attributes);
      }
    }
    if (lastFailure) {
      return lastFailure;
    }
    const remaining = nodes
      .map(
        (node) =>
          Math.max(
            node.blocked.get(target.origin) ?? 0,
            node.blocked.get(operationKey) ?? 0,
            node.blocked.get(resource) ?? 0
          ) - now()
      )
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
