// Stream events, lease acquisition, and retries must remain sequential to preserve checkpoint ordering.
// oxlint-disable no-await-in-loop
import { setTimeout as delay } from "node:timers/promises";

import { ProtocolError } from "@asm/protocols/contracts";
import { streamJetstream } from "@asm/protocols/jetstream";
import type {
  JetstreamEvent,
  JetstreamOptions,
} from "@asm/protocols/jetstream";
import { metrics } from "@opentelemetry/api";

import type { ProtocolsHealth } from "./app";
import type { CheckpointStore } from "./checkpoints";
import type { ProtocolLogger } from "./observability";

const events = metrics
  .getMeter("asm-protocols")
  .createCounter("asm.protocols.jetstream.events");

// A connection must survive this long before its next drop is treated as a
// fresh incident rather than a continuing one.
const HEALTHY_CONNECTION_MS = 30_000;
// Warnings are useful on the first few attempts and then become noise; a
// persistent outage is reported once per this many failures instead.
const RETRY_WARN_INTERVAL = 12;

export async function waitForRetry(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    return;
  }
  // Cancellation resolves retry waits normally so shutdown never schedules another connection.
  try {
    await delay(milliseconds, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}

export interface JetstreamWorkerOptions {
  store: CheckpointStore;
  streamOptions: Pick<
    JetstreamOptions,
    "dids" | "endpoint" | "collections" | "publicDiscovery"
  >;
  signal: AbortSignal;
  health: ProtocolsHealth;
  logger: ProtocolLogger;
  invalidate: (event?: JetstreamEvent) => void;
  processEvent?: (event: JetstreamEvent) => Promise<void>;
  stream?: (options: JetstreamOptions) => AsyncIterable<JetstreamEvent>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  renewEveryMs?: number;
  standbyWaitMs?: number;
}

export async function runJetstreamWorker(
  options: JetstreamWorkerOptions
): Promise<void> {
  const wait = options.wait ?? waitForRetry;
  const stream = options.stream ?? streamJetstream;
  const tracked = new Set(options.streamOptions.dids);
  let attempt = 0;
  let connectedAt: number | undefined;
  while (!options.signal.aborted) {
    let renewTimer: ReturnType<typeof setInterval> | undefined;
    const leaseAbort = new AbortController();
    let renewing = false;
    connectedAt = undefined;
    try {
      if (!(await options.store.acquire())) {
        options.logger.debug(
          { event: "jetstream.standby" },
          "Another instance owns the stream"
        );
        // Standby poll interval: 1.5s ensures that when a previous container is
        // replaced or shut down by Dokploy, the replacement instance claims the
        // stream promptly without unnecessary delay.
        await wait(options.standbyWaitMs ?? 1500, options.signal);
        continue;
      }
      options.health.leaseHeld = true;
      let cursor = await options.store.load();
      const signal = AbortSignal.any([options.signal, leaseAbort.signal]);
      renewTimer = setInterval(() => {
        if (renewing) {
          return;
        }
        renewing = true;
        void (async () => {
          try {
            if (!(await options.store.renew())) {
              leaseAbort.abort();
            }
          } catch {
            leaseAbort.abort();
          } finally {
            renewing = false;
          }
        })();
      }, options.renewEveryMs ?? 3000);
      renewTimer.unref();
      for await (const event of stream({
        ...options.streamOptions,
        cursor,
        onConnected: () => {
          options.health.connected = true;
          options.logger.info(
            { event: "jetstream.connected", trackedAccounts: tracked.size },
            "Jetstream connected"
          );
        },
        signal,
      })) {
        if (signal.aborted) {
          break;
        }
        if (cursor !== undefined && event.seq <= cursor) {
          continue;
        }
        if (!options.streamOptions.publicDiscovery && !tracked.has(event.did)) {
          throw new ProtocolError(
            "invalid_response",
            "Jetstream returned an untracked account"
          );
        }
        await options.processEvent?.(event);
        options.invalidate(event);
        await options.store.commit(event);
        cursor = event.seq;
        options.health.processedEvents += 1;
        options.health.lastEventAt = Date.now();
        events.add(1, { kind: event.kind });
        // Reset only after a connection proves it is healthy. Resetting on every
        // single event meant a stream that dies right after one frame retried at
        // the one-second floor forever, logging a warning each time.
        connectedAt ??= Date.now();
        if (Date.now() - connectedAt >= HEALTHY_CONNECTION_MS) {
          attempt = 0;
        }
      }
      if (!options.signal.aborted) {
        throw new ProtocolError("unavailable", "Jetstream connection ended");
      }
    } catch (error) {
      if (!options.signal.aborted) {
        attempt += 1;
        const isReconciliation =
          (error instanceof ProtocolError &&
            (error.code === "unavailable" ||
              error.code === "invalid_response") &&
            error.message.toLowerCase().includes("reconciliation")) ||
          (error instanceof Error &&
            error.message.toLowerCase().includes("cursortoold"));
        if (isReconciliation) {
          options.logger.warn(
            { attempt, event: "jetstream.cursor_reset" },
            "Jetstream cursor out of range or requires reconciliation; resuming from live edge"
          );
          await options.store.resetCursor?.().catch(() => null);
        }
        const code =
          error instanceof ProtocolError
            ? error.code
            : "checkpoint_unavailable";
        // A flapping upstream can retry many times a minute. Warn on the first
        // attempts, then only every RETRY_WARN_INTERVAL-th failure, so a real
        // outage stays visible without drowning the log.
        const warn =
          !isReconciliation &&
          (attempt <= 3 || attempt % RETRY_WARN_INTERVAL === 0);
        const fields = {
          attempt,
          code,
          event: "jetstream.retry",
          reason: error instanceof Error ? error.message : "Checkpoint failure",
        };
        if (warn) {
          options.logger.warn(
            fields,
            "Jetstream paused; reconnecting from its checkpoint"
          );
        } else {
          options.logger.debug(fields, "Jetstream retry during an outage");
        }
      }
    } finally {
      if (renewTimer) {
        clearInterval(renewTimer);
      }
      leaseAbort.abort();
      options.health.connected = false;
      if (options.health.leaseHeld) {
        try {
          await options.store.release();
        } catch {
          options.logger.warn(
            { event: "jetstream.lease_release_failed" },
            "Jetstream lease will expire automatically"
          );
        }
      }
      options.health.leaseHeld = false;
    }
    if (!options.signal.aborted) {
      await wait(
        Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) +
          Math.floor(Math.random() * 250),
        options.signal
      );
    }
  }
  options.logger.info(
    {
      event: "jetstream.stopped",
      processedEvents: options.health.processedEvents,
    },
    "Jetstream stopped"
  );
}
