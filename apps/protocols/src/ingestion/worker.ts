// Stream events, lease acquisition, and retries must remain sequential to preserve checkpoint ordering.
// oxlint-disable no-await-in-loop
import { setTimeout as delay } from "node:timers/promises";

import { ProtocolError } from "@asm/protocols/contracts";
import { replayJetstream, streamJetstream } from "@asm/protocols/jetstream";
import type {
  JetstreamEvent,
  JetstreamOptions,
  ReplayOptions,
} from "@asm/protocols/jetstream";
import { metrics } from "@opentelemetry/api";

import type { ProtocolsHealth } from "../http/app";
import type { ProtocolLogger } from "../runtime/observability";
import type { CheckpointStore } from "./checkpoints";

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
    "dids" | "endpoint" | "collections" | "publicDiscovery" | "apiKey"
  >;
  signal: AbortSignal;
  health: ProtocolsHealth;
  logger: ProtocolLogger;
  invalidate: (event?: JetstreamEvent) => void;
  processEvent?: (event: JetstreamEvent) => Promise<void>;
  stream?: (options: JetstreamOptions) => AsyncIterable<JetstreamEvent>;
  replay?: (options: ReplayOptions) => AsyncIterable<JetstreamEvent>;
  // API key for metered replay catch-up. Absent means gaps resume from the
  // live edge, as before; the key is never logged.
  apiKey?: string;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  renewEveryMs?: number;
  standbyWaitMs?: number;
  // Checkpoint writes are the hottest Redis traffic on the firehose path, so
  // commits are batched: flush after this many events or this many
  // milliseconds, whichever comes first, plus on loop exit. At-least-once
  // delivery plus the seq<=cursor skip makes redelivery harmless.
  commitBatchEvents?: number;
  commitBatchMs?: number;
}

export async function runJetstreamWorker(
  options: JetstreamWorkerOptions
): Promise<void> {
  const wait = options.wait ?? waitForRetry;
  const stream = options.stream ?? streamJetstream;
  const replay = options.replay ?? replayJetstream;
  const commitBatchEvents = options.commitBatchEvents ?? 50;
  const commitBatchMs = options.commitBatchMs ?? 1000;
  const tracked = new Set(options.streamOptions.dids);
  let attempt = 0;
  let connectedAt: number | undefined;
  let catchUpFrom: number | undefined;
  let replayFrom: number | undefined;
  let replayStrikes = 0;
  const maxReplayStrikes = 3;
  // Checkpoint batching lives outside the reconnect loop: flushes happen on
  // the heartbeat, on batch thresholds, and on loop exit, so a pending batch
  // is never stranded by a reconnect. Duplicates are harmless because the
  // cursor only moves forward and the seq<=cursor skip drops replays.
  let pendingEvents: JetstreamEvent[] = [];
  let lastCommitAt = Date.now();
  const flushCommit = async () => {
    const batch = pendingEvents;
    if (!batch.length) {
      return;
    }
    pendingEvents = [];
    lastCommitAt = Date.now();
    await options.store.commitBatch(batch);
    options.health.processedEvents += batch.length;
  };
  while (!options.signal.aborted) {
    let renewTimer: ReturnType<typeof setInterval> | undefined;
    const leaseAbort = new AbortController();
    let renewing = false;
    connectedAt = undefined;
    let usedReplay = false;
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
            // Flush checkpoints on the heartbeat so an idle-but-open stream
            // cannot hold an uncommitted checkpoint indefinitely. Failures
            // abort the lease, consistent with renewal failures.
            await flushCommit();
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
      const useReplay =
        catchUpFrom !== undefined &&
        options.apiKey !== undefined &&
        replayStrikes < maxReplayStrikes;
      replayFrom = catchUpFrom;
      catchUpFrom = undefined;
      usedReplay = useReplay;
      const onConnected = () => {
        options.health.connected = true;
        options.logger.info(
          {
            event: "jetstream.connected",
            publicDiscovery: options.streamOptions.publicDiscovery ?? false,
            trackedAccounts: tracked.size,
          },
          "Jetstream connected"
        );
      };
      const source = useReplay
        ? replay({
            afterSeq: replayFrom as number,
            apiKey: options.apiKey as string,
            collections: options.streamOptions.collections,
            dids: options.streamOptions.dids,
            endpoint: options.streamOptions.endpoint,
            onConnected,
            signal,
          })
        : stream({
            ...options.streamOptions,
            cursor,
            onConnected,
            signal,
          });
      for await (const event of source) {
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
        cursor = event.seq;
        options.health.lastEventAt = Date.now();
        options.health.lastSourceEventAt = Date.parse(event.time);
        events.add(1, { kind: event.kind });
        replayStrikes = 0;
        pendingEvents.push(event);
        if (
          pendingEvents.length >= commitBatchEvents ||
          Date.now() - lastCommitAt >= commitBatchMs
        ) {
          await flushCommit();
        }
        // Reset only after a connection proves it is healthy. Resetting on every
        // single event meant a stream that dies right after one frame retried at
        // the one-second floor forever, logging a warning each time.
        connectedAt ??= Date.now();
        if (Date.now() - connectedAt >= HEALTHY_CONNECTION_MS) {
          attempt = 0;
        }
      }
      try {
        await flushCommit();
      } catch (error) {
        if (!signal.aborted) {
          throw error;
        }
      }
      if (!options.signal.aborted) {
        throw new ProtocolError("unavailable", "Jetstream connection ended");
      }
    } catch (error) {
      if (!options.signal.aborted) {
        attempt += 1;
        try {
          await flushCommit();
        } catch {
          // The original stream error drives the retry; lease loss also
          // surfaces through the renewal heartbeat and standby handoff.
        }
        if (usedReplay) {
          // A replay that yields nothing is indistinguishable from a
          // connection that died before the first frame; either way the gap
          // is still open, so keep the intent and count the strike. Resume
          // from the latest committed sequence after partial progress.
          replayStrikes += 1;
          const resumeFrom = await options.store.load().catch(() => {
            /* empty */
          });
          catchUpFrom = resumeFrom ?? replayFrom;
        }
        const isReconciliation =
          (error instanceof ProtocolError &&
            (error.code === "unavailable" ||
              error.code === "invalid_response") &&
            error.message.toLowerCase().includes("reconciliation")) ||
          (error instanceof Error &&
            error.message.toLowerCase().includes("cursortooold"));
        if (isReconciliation) {
          const lastSeq = await options.store.load().catch(() => {
            /* empty */
          });
          if (
            options.apiKey !== undefined &&
            lastSeq !== undefined &&
            replayStrikes < maxReplayStrikes
          ) {
            // Catch up through archive replay instead of jumping to the live
            // edge: the gap replays idempotently (seq<=cursor skips) and the
            // stream cuts over to live at the tip on its own. The durable
            // cursor is left intact so a handoff or restart replays from the
            // same boundary instead of resuming from live edge.
            catchUpFrom = lastSeq;
            options.logger.info(
              { attempt, event: "jetstream.replay_catchup", fromSeq: lastSeq },
              "Jetstream cursor out of range; replaying missed events instead of resuming from live edge"
            );
          } else {
            if (
              options.apiKey !== undefined &&
              lastSeq !== undefined &&
              replayStrikes >= maxReplayStrikes
            ) {
              options.logger.warn(
                { attempt, event: "jetstream.replay_exhausted" },
                "Jetstream replay failed repeatedly; resuming from live edge"
              );
            } else {
              options.logger.warn(
                { attempt, event: "jetstream.cursor_reset" },
                "Jetstream cursor out of range or requires reconciliation; resuming from live edge"
              );
            }
            await options.store.resetCursor?.().catch(() => null);
          }
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
