import { Writable } from "node:stream";

const LEVELS: Record<string, { severityText: string; severityNumber: number }> =
  {
    "10": { severityText: "TRACE", severityNumber: 1 },
    "20": { severityText: "DEBUG", severityNumber: 5 },
    "30": { severityText: "INFO", severityNumber: 9 },
    "40": { severityText: "WARN", severityNumber: 13 },
    "50": { severityText: "ERROR", severityNumber: 17 },
    "60": { severityText: "FATAL", severityNumber: 21 },
  };

export interface OtlpLogDestinationOptions {
  batchSize?: number;
  endpoint: string;
  flushIntervalMs?: number;
  headers: Record<string, string>;
  serviceName?: string;
}

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; kvlistValue?: { values: OtlpAttribute[] } };
}

function toNanoSeconds(timeIso: string | number): string {
  if (typeof timeIso === "number") {
    return BigInt(timeIso * 1_000_000).toString();
  }
  const ms = Date.parse(timeIso);
  if (Number.isNaN(ms)) {
    return (BigInt(Date.now()) * BigInt(1_000_000)).toString();
  }
  return (BigInt(ms) * BigInt(1_000_000)).toString();
}

function toAttributeValue(value: unknown): OtlpAttribute["value"] {
  if (value !== null && typeof value === "object") {
    return {
      kvlistValue: { values: flattenObject(value as Record<string, unknown>) },
    };
  }
  return { stringValue: String(value) };
}

function flattenObject(obj: Record<string, unknown>): OtlpAttribute[] {
  return Object.entries(obj)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ key, value: toAttributeValue(value) }));
}

function toOtlpLogRecord(line: Record<string, unknown>, serviceName: string) {
  const level = String(line.level ?? 30);
  const severity = LEVELS[level] ?? { severityText: "INFO", severityNumber: 9 };
  const attributes: OtlpAttribute[] = [];

  for (const [key, value] of Object.entries(line)) {
    if (
      key === "level" ||
      key === "msg" ||
      key === "time" ||
      key === "pid" ||
      key === "hostname"
    ) {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    attributes.push({ key, value: toAttributeValue(value) });
  }

  return {
    timeUnixNano: toNanoSeconds(String(line.time ?? Date.now())),
    severityNumber: severity.severityNumber,
    severityText: severity.severityText,
    body: { stringValue: String(line.msg ?? "") },
    attributes,
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: serviceName } },
      ],
    },
  };
}

// A Writable stream that converts pino JSON records to OTLP/HTTP JSON log
// records and posts them to OpenObserve in batches. Avoids worker threads so
// it works inside a `bun build --compile` binary.
export function createOtlpLogDestination(
  options: OtlpLogDestinationOptions
): Writable {
  const { endpoint, headers, serviceName = "app" } = options;
  const batchSize = options.batchSize ?? 100;
  const flushIntervalMs = options.flushIntervalMs ?? 2000;

  const queue: Record<string, unknown>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) {
      return;
    }
    const records = queue.splice(0, queue.length);
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: serviceName } },
            ],
          },
          scopeLogs: [
            {
              logRecords: records.map((record) =>
                toOtlpLogRecord(record, serviceName)
              ),
            },
          ],
        },
      ],
    };

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      // Logging must never crash the service; fall back to stderr.
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[otel-log] failed to export logs: ${message}\n`);
    }
  }

  function scheduleFlush() {
    if (!timer && queue.length > 0) {
      timer = setTimeout(() => {
        flush().catch(() => undefined);
      }, flushIntervalMs);
    }
  }

  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        const line = JSON.parse(chunk.toString()) as Record<string, unknown>;
        queue.push(line);
        if (queue.length >= batchSize) {
          flush().catch(() => undefined);
        } else {
          scheduleFlush();
        }
      } catch {
        // Ignore malformed lines.
      }
      callback();
    },
    final(callback) {
      flush()
        .catch(() => undefined)
        .finally(() => callback());
    },
  });
}
