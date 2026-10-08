import { getTelemetryApi } from "@asm/logger";

export type MessageSearchWorkerJob = "live-index" | "backfill" | "count";
export type MessageSearchWorkerOutcome =
  | "completed"
  | "indexed"
  | "retry"
  | "skipped"
  | "superseded"
  | "unreadable";

export interface MessageSearchWorkerMetricEvent {
  durationMs: number;
  job: MessageSearchWorkerJob;
  outcome: MessageSearchWorkerOutcome;
  queueAgeMs?: number;
  rows?: number;
  unreadableRows?: number;
}

export interface MessageSearchWorkerMetricSink {
  record: (event: MessageSearchWorkerMetricEvent) => void;
}

function finiteMilliseconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function createMessageSearchWorkerMetricSink(): MessageSearchWorkerMetricSink {
  try {
    const { meter } = getTelemetryApi();
    const jobs = meter.createCounter("messages.search.worker.jobs", {
      description: "DM search worker jobs by job type and outcome",
    });
    const duration = meter.createHistogram("messages.search.worker.duration", {
      description: "DM search worker job duration",
      unit: "ms",
    });
    const queueAge = meter.createHistogram("messages.search.worker.queue_age", {
      description: "Age of durable DM search work when processing starts",
      unit: "ms",
    });
    const rows = meter.createCounter("messages.search.worker.rows", {
      description: "Rows traversed or completed by DM search workers",
    });
    const unreadableRows = meter.createCounter(
      "messages.search.worker.unreadable_rows",
      {
        description: "Backfill rows without a readable message-key epoch",
      }
    );

    return {
      record(event) {
        const attributes = { job: event.job, outcome: event.outcome };
        jobs.add(1, attributes);
        duration.record(finiteMilliseconds(event.durationMs), attributes);
        if (event.queueAgeMs !== undefined) {
          queueAge.record(finiteMilliseconds(event.queueAgeMs), {
            job: event.job,
          });
        }
        if (event.rows !== undefined && event.rows > 0) {
          rows.add(Math.trunc(event.rows), attributes);
        }
        if (event.unreadableRows !== undefined && event.unreadableRows > 0) {
          unreadableRows.add(Math.trunc(event.unreadableRows), {
            job: event.job,
          });
        }
      },
    };
  } catch {
    return { record: (event) => undefined };
  }
}

export function safelyRecordMessageSearchWorkerMetric(
  sink: MessageSearchWorkerMetricSink | undefined,
  event: MessageSearchWorkerMetricEvent
): void {
  try {
    sink?.record(event);
  } catch {
    // Injected or exporter-backed recorders must never fail the worker job.
  }
}
