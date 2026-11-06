import { getTelemetryApi } from "@asm/logger";

export type MessageSearchWorkerJob = "live-index" | "backfill" | "count";
export type MessageSearchWorkerOutcome =
  | "completed"
  | "indexed"
  | "retry"
  | "skipped"
  | "superseded"
  | "unreadable"
  | "repair";

export interface MessageSearchWorkerMetricEvent {
  durationMs: number;
  job: MessageSearchWorkerJob;
  outcome: MessageSearchWorkerOutcome;
  processRssBytes?: number;
  queueAgeMs?: number;
  rows?: number;
  unreadableRows?: number;
}

export interface MessageSearchWorkerMetricSink {
  record: (event: MessageSearchWorkerMetricEvent) => void;
}

export interface MessageSearchWorkerMetricCounter {
  add: (value: number, attributes?: Record<string, string>) => void;
}

export interface MessageSearchWorkerMetricHistogram {
  record: (value: number, attributes?: Record<string, string>) => void;
}

export interface MessageSearchWorkerMetricMeter {
  createCounter: (
    name: string,
    options: { description: string }
  ) => MessageSearchWorkerMetricCounter;
  createHistogram: (
    name: string,
    options: { description: string; unit: string }
  ) => MessageSearchWorkerMetricHistogram;
}

function finiteMeasurement(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function currentProcessRssBytes(): number | undefined {
  try {
    const value = process.memoryUsage().rss;
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createMessageSearchWorkerMetricSink(
  getMeter: () => MessageSearchWorkerMetricMeter = () => getTelemetryApi().meter
): MessageSearchWorkerMetricSink {
  try {
    const meter = getMeter();
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
    const rowsPerSecond = meter.createHistogram(
      "messages.search.worker.rows_per_second",
      {
        description: "DM search worker row processing throughput",
        unit: "rows/s",
      }
    );
    const processRss = meter.createHistogram(
      "messages.search.worker.process_rss_bytes",
      {
        description: "DM search worker process resident memory after a job",
        unit: "By",
      }
    );
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
        duration.record(finiteMeasurement(event.durationMs), attributes);
        if (event.queueAgeMs !== undefined) {
          queueAge.record(finiteMeasurement(event.queueAgeMs), {
            job: event.job,
          });
        }
        if (
          event.rows !== undefined &&
          Number.isFinite(event.rows) &&
          event.rows > 0
        ) {
          const rowCount = Math.trunc(event.rows);
          rows.add(rowCount, attributes);
          if (event.durationMs > 0) {
            rowsPerSecond.record(
              finiteMeasurement((rowCount * 1000) / event.durationMs),
              { job: event.job }
            );
          }
        }
        if (
          event.processRssBytes !== undefined &&
          Number.isFinite(event.processRssBytes) &&
          event.processRssBytes >= 0
        ) {
          processRss.record(event.processRssBytes, { job: event.job });
        }
        if (
          event.unreadableRows !== undefined &&
          Number.isFinite(event.unreadableRows) &&
          event.unreadableRows > 0
        ) {
          unreadableRows.add(Math.trunc(event.unreadableRows), {
            job: event.job,
          });
        }
      },
    };
  } catch {
    return { record: (event) => event.durationMs };
  }
}

export function safelyRecordMessageSearchWorkerMetric(
  sink: MessageSearchWorkerMetricSink | undefined,
  event: MessageSearchWorkerMetricEvent
): void {
  if (!sink) {
    return;
  }
  const processRssBytes = currentProcessRssBytes();
  try {
    sink.record({
      ...event,
      ...(processRssBytes === undefined ? {} : { processRssBytes }),
    });
  } catch {
    // Injected or exporter-backed recorders must never fail the worker job.
  }
}
