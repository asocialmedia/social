import type {
  ProtocolDiagnostic,
  ProtocolObserver,
} from "@asm/protocols/contracts";
import {
  abortable,
  readJsonBounded,
  retryAfterMs,
} from "@asm/protocols/discovery";

import {
  createGeneratorBackoff,
  publicReadHeaders,
  publicReadRateLimitScope,
  publicReadTarget,
} from "./read-worker-policy";

export function createWorkerReader(options: {
  concurrency?: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  observe?: ProtocolObserver;
}) {
  const now = options.now ?? Date.now;
  const generatorBackoff = createGeneratorBackoff(now);
  const blocked = new Map<string, number>();
  const abort = new AbortController();
  let active = 0;
  let draining = false;
  return {
    drain() {
      draining = true;
      abort.abort();
    },
    async fetch(raw: string, init: RequestInit): Promise<Response> {
      const headers = { "cache-control": "no-store", "x-asm-read-worker": "1" };
      const target = publicReadTarget(raw);
      if (
        !target ||
        (init.method && init.method !== "GET") ||
        init.body ||
        new Headers(init.headers).has("authorization")
      ) {
        return Response.json(
          { error: "invalid_target" },
          { headers, status: 400 }
        );
      }
      if (draining || active >= (options.concurrency ?? 8)) {
        return Response.json(
          { error: "worker_busy" },
          { headers: { ...headers, "retry-after": "1" }, status: 503 }
        );
      }
      const scope = publicReadRateLimitScope(target);
      const remaining = Math.max(
        (blocked.get(target.origin) ?? 0) - now(),
        (blocked.get(scope) ?? 0) - now(),
        generatorBackoff.remaining(target)
      );
      if (remaining > 0) {
        return Response.json(
          { error: "upstream_cooldown" },
          {
            headers: {
              ...headers,
              "retry-after": String(Math.ceil(remaining / 1000)),
            },
            status: 429,
          }
        );
      }
      active += 1;
      const startedAt = now();
      const operation = `worker.transport.${target.pathname.slice(6)}`;
      try {
        const signal = AbortSignal.any([
          abort.signal,
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(2500),
        ]);
        const response = await abortable(
          (options.fetch ?? globalThis.fetch)(target.href, {
            headers: publicReadHeaders(init.headers),
            method: "GET",
            redirect: "error",
            signal,
          }),
          signal
        );
        let retryAfter: string | undefined;
        if (response.status === 429) {
          const delay =
            retryAfterMs(response.headers.get("retry-after"), now()) ?? 30_000;
          generatorBackoff.record(target, delay);
          for (const [key, until] of blocked) {
            if (until <= now()) {
              blocked.delete(key);
            }
          }
          if (blocked.size >= 512 && !blocked.has(scope)) {
            blocked.delete(blocked.keys().next().value ?? "");
          }
          const until = Math.max(blocked.get(scope) ?? 0, now() + delay);
          blocked.set(scope, until);
          retryAfter = String(
            Math.ceil(
              Math.max(until - now(), generatorBackoff.remaining(target)) / 1000
            )
          );
        }
        let body: unknown;
        try {
          body = await readJsonBounded(response, 2 * 1024 * 1024, signal);
        } catch (error) {
          if (response.ok) {
            throw error;
          }
          body = { error: "upstream_error" };
        }
        const expectedMissingDeclaration =
          response.status === 400 &&
          target.pathname === "/xrpc/com.atproto.repo.getRecord" &&
          target.searchParams.get("collection") ===
            "app.bsky.actor.contentVisibilityDeclaration" &&
          target.searchParams.get("rkey") === "self" &&
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          body.error === "RecordNotFound";
        const successfulLookup = response.ok || expectedMissingDeclaration;
        let code: ProtocolDiagnostic["code"];
        if (!successfulLookup) {
          code = response.status === 429 ? "rate_limited" : "unavailable";
          if (response.status === 401 || response.status === 403) {
            code = "restricted";
          } else if (
            response.status === 400 &&
            target.pathname === "/xrpc/com.atproto.repo.listRecords"
          ) {
            code = "invalid_input";
          }
        }
        options.observe?.({
          code,
          durationMs: now() - startedAt,
          operation,
          outcome: successfulLookup ? "success" : "error",
          status: response.status,
        });
        return Response.json(body, {
          headers: {
            ...headers,
            "x-asm-upstream-status": String(response.status),
            ...(retryAfter ? { "retry-after": retryAfter } : {}),
          },
          status: response.status,
        });
      } catch {
        init.signal?.throwIfAborted();
        options.observe?.({
          code: "unavailable",
          durationMs: now() - startedAt,
          operation,
          outcome: "error",
          status: 502,
        });
        return Response.json(
          { error: "upstream_unavailable" },
          { headers, status: 502 }
        );
      } finally {
        active -= 1;
      }
    },
    status: () => ({ active, draining }),
  };
}
