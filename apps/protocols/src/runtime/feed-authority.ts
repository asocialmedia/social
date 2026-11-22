import type { ProtocolDiagnostic } from "@asm/protocols/contracts";
import {
  decideFeedAuthority,
  feedAuthorityExpirySeconds,
  feedAuthorityKeys,
  feedAuthorityVersion,
  readJsonBounded,
} from "@asm/protocols/discovery";
import type { ProtocolFeedHealth } from "@asm/protocols/discovery";
import type Redis from "ioredis";
import { z } from "zod";

import { readWorkerNodes } from "../reader/read-worker-config";
import type { ReadWorkerNode } from "../reader/read-worker-config";
import type { ProtocolLogger } from "./observability";

export function createUpstreamHealth(now = Date.now) {
  const buckets = new Map<number, ProtocolFeedHealth["upstream"]>();
  const recent = () => {
    const minute = Math.floor(now() / 15_000);
    for (const interval of buckets.keys()) {
      if (interval < minute - 3) {
        buckets.delete(interval);
      }
    }
    return minute;
  };
  return {
    observe(diagnostic: ProtocolDiagnostic) {
      // A generator denial or separate search-host limit cannot declare AppView down.
      if (
        ![
          "app.bsky.feed.getPosts",
          "app.bsky.feed.getSuggestedFeeds",
          "app.bsky.unspecced.getPopularFeedGenerators",
        ].includes(diagnostic.operation) ||
        diagnostic.outcome === "cache_hit"
      ) {
        return;
      }
      const interval = recent();
      const bucket = buckets.get(interval) ?? {
        failed: 0,
        limited: 0,
        succeeded: 0,
      };
      if (diagnostic.outcome === "success") {
        bucket.succeeded += 1;
      } else if (diagnostic.code === "rate_limited") {
        bucket.limited += 1;
      } else if (diagnostic.code === "unavailable") {
        bucket.failed += 1;
      }
      buckets.set(interval, bucket);
    },
    snapshot() {
      recent();
      const totals = { failed: 0, limited: 0, succeeded: 0 };
      for (const bucket of buckets.values()) {
        totals.failed += bucket.failed;
        totals.limited += bucket.limited;
        totals.succeeded += bucket.succeeded;
      }
      return totals;
    },
  };
}

const readinessSchema = z.object({
  active: z.number().int().min(0).max(32).optional(),
  capacity: z.number().int().min(1).max(32).optional(),
  id: z.string(),
  ingestion: z.object({ storageReady: z.boolean() }).optional(),
  mode: z.literal("read-worker"),
  version: z.string(),
});

export function createWorkerDiscovery(options: {
  redis: Pick<Redis, "get">;
  configured: ReadWorkerNode[];
  fetch?: (url: URL, init: RequestInit) => Promise<Response>;
}) {
  let desired = options.configured;
  return async () => {
    try {
      const override = await options.redis.get(feedAuthorityKeys.workers);
      if (override && override.length > 8192) {
        throw new Error("Worker configuration exceeds limit");
      }
      desired =
        override === null ? options.configured : readWorkerNodes(override);
    } catch {
      // Preserve the last validated topology when Redis is unavailable or an edit is invalid.
    }
    const status = await Promise.all(
      desired.map(async (node) => {
        try {
          const signal = AbortSignal.timeout(900);
          const response = await (options.fetch ?? fetch)(
            new URL("/ready", node.url),
            {
              headers: { authorization: `Bearer ${node.token}` },
              redirect: "error",
              signal,
            }
          );
          if (
            !response.ok ||
            response.headers.get("x-asm-read-worker") !== "1"
          ) {
            await response.body?.cancel();
            return null;
          }
          const report = readinessSchema.parse(
            await readJsonBounded(response, 8192, signal)
          );
          return report.id === node.id ? { node, report } : null;
        } catch {
          return null;
        }
      })
    );
    const ready = status.filter((entry) => entry !== null);
    return {
      hydrationNodes: ready
        .filter(({ report }) => report.ingestion?.storageReady)
        .map(({ node }) => node.id),
      readNodes: ready.map(({ node, report }) =>
        report.capacity ? { ...node, capacity: report.capacity } : node
      ),
      workers: ready.map(({ report }) => ({
        active: report.active ?? 0,
        capacity: report.capacity ?? 8,
        id: report.id,
        version: report.version,
      })),
    };
  };
}

export function createProtocolFeedPublisher(
  redis: Pick<Redis, "set">,
  logger: ProtocolLogger,
  now = Date.now
) {
  let loggedAt = 0;
  let lastReason: string | undefined;
  return async (report: ProtocolFeedHealth) => {
    await redis.set(
      feedAuthorityKeys.protocols,
      JSON.stringify(report),
      "EX",
      feedAuthorityExpirySeconds
    );
    const reason = decideFeedAuthority(report, null, now()).bluesky?.reason;
    if (reason !== lastReason || now() - loggedAt >= 60_000) {
      const log = reason ? logger.warn : logger.info;
      log.call(
        logger,
        {
          ...report,
          event: "feed.authority.protocols",
          policyVersion: feedAuthorityVersion,
          reason: reason ?? "healthy_or_unknown",
        },
        "Feed authority evaluated Bluesky capacity"
      );
      lastReason = reason;
      loggedAt = now();
    }
  };
}
